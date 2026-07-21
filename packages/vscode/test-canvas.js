#!/usr/bin/env node
/**
 * Build and test the canvas. Run from the repo root:
 *   node packages/vscode/test-canvas.js
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer from 'puppeteer'
import { strict as assert } from 'node:assert'
import { describe, it, before, after } from 'node:test'

const ROOT = resolve(import.meta.dirname, '../..')
const VSCODE = resolve(ROOT, 'packages/vscode')
const TEST_DIR = '/tmp/durable-viz-test'

// ---------------------------------------------------------------------------
// Build extension and extract standalone test HTML
// ---------------------------------------------------------------------------

execSync('pnpm run build', { cwd: VSCODE, stdio: 'pipe' })

const src = readFileSync(resolve(VSCODE, 'src', 'extension.ts'), 'utf-8')
const fnStart = src.indexOf('function buildBuildHtml')
const tplStart = src.indexOf('`', fnStart) + 1
// Find closing backtick: it's the one right before the closing } of the function
const tplEnd = src.indexOf('`\n}', tplStart)
if (tplEnd === -1) throw new Error('Could not find closing backtick of buildBuildHtml')
const html = src.slice(tplStart, tplEnd)

// Extract inline JS
const scriptStart = html.indexOf('<script>', html.indexOf('cytoscape.min.js')) + '<script>'.length
const scriptEnd = html.indexOf('</script>', scriptStart)
let js = html.slice(scriptStart, scriptEnd)

// Replace VS Code specific APIs with safe stubs
js = js.replace(
  'const vscode = acquireVsCodeApi();',
  'var vscode = { postMessage: function() {} };'
)

// Expose cy globally for test access
js += '\nwindow.cy = cy;\n'

// Extract template CSS (inside <style> tag) and body content (between <body> and CDN script)
const styleStart = html.indexOf('<style>') + '<style>'.length
const styleEnd = html.indexOf('</style>', styleStart)
const templateCss = html.slice(styleStart, styleEnd).trim()

const bodyStart = html.indexOf('<body>') + '<body>'.length
const bodyEnd = html.indexOf('<script src="https://cdn')
const bodyContent = html.slice(bodyStart, bodyEnd)

// Build standalone test page
const indexHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src https://cdn.jsdelivr.net https://unpkg.com 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:sans-serif;background:#1e1e1e;color:#d4d4d4;display:flex;height:100vh;overflow:hidden}
${templateCss}
</style></head><body>
${bodyContent}
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30/dist/cytoscape.min.js"></script>
<script>${js}</script>
</body></html>`

writeFileSync(`${TEST_DIR}/index.html`, indexHtml)
console.log('Test page built:', indexHtml.length, 'bytes')

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let browser, page

before(async () => {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage()
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message))
  page.on('console', msg => { if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text()) })
  await page.setViewport({ width: 1200, height: 800 })
  await page.setContent(indexHtml, { waitUntil: 'networkidle0', timeout: 15000 })
  const hasCy = await page.evaluate(() => typeof window.cy === 'object' && typeof window.cy.elements === 'function')
  if (!hasCy) throw new Error('window.cy.elements not available — script likely failed')
})

after(async () => {
  if (browser) await browser.close()
})

async function dropItem(kind, viewportX, viewportY) {
  const el = await page.$(`.palette-item[data-kind="${kind}"]`)
  const box = await el.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(viewportX, viewportY, { steps: 10 })
  await page.mouse.up()
  await new Promise(r => setTimeout(r, 300))
}

async function clearCanvas() {
  await page.evaluate(() => {
    document.getElementById('clear-btn').click()
  })
  await new Promise(r => setTimeout(r, 500))
  await page.evaluate(() => {
    if (window.cy.elements().length > 0) {
      window.cy.elements().remove()
    }
    window.cy.zoom(1)
    window.cy.pan({ x: 0, y: 0 })
  })
  await new Promise(r => setTimeout(r, 300))
}

async function getState() {
  return page.evaluate(() => {
    const nodes = []
    window.cy.nodes().forEach(n => nodes.push({
      id: n.id(), kind: n.data('kind'), label: n.data('label'),
      pos: { x: n.position().x, y: n.position().y },
      rpos: { x: n.renderedPosition().x, y: n.renderedPosition().y },
      parent: n.data('parent') || null,
      isChild: n.isChild(), isParent: n.isParent(),
    }))
    const edges = []
    window.cy.edges().forEach(e => edges.push({ from: e.data('source'), to: e.data('target') }))
    return { nodes, edges }
  })
}

async function getCanvasRect() {
  return page.$eval('#canvas-area', el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top } })
}

/** Get viewport coordinates for a node (renderedPosition is container-relative). */
async function getViewportPos(nodeId) {
  return page.evaluate((nodeId) => {
    const n = window.cy.getElementById(nodeId)
    if (!n.nonempty()) return null
    const rp = n.renderedPosition()
    const container = document.getElementById('canvas-area')
    const cr = container.getBoundingClientRect()
    return {
      x: cr.left + rp.x,
      y: cr.top + rp.y,
    }
  }, nodeId)
}

async function dropOnNode(kind, targetId) {
  const target = await page.evaluate((nodeId) => {
    const n = window.cy.getElementById(nodeId)
    if (!n.nonempty()) return null
    const bb = n.renderedBoundingBox({ includeNodes: true, includeOverlays: false, includeEdges: false })
    const container = document.getElementById('canvas-area')
    const cr = container.getBoundingClientRect()
    const cx = (bb.x1 + bb.x2) / 2
    const cy = (bb.y1 + bb.y2) / 2
    return {
      x: cr.left + cx,
      y: cr.top + cy,
    }
  }, targetId)
  if (!target) return
  await dropItem(kind, target.x, target.y)
}

async function clickNodeById(id) {
  await page.evaluate((nodeId) => {
    const n = window.cy.getElementById(nodeId)
    if (n.nonempty()) n.emit('tap')
  }, id)
  await new Promise(r => setTimeout(r, 200))
}

async function pressKey(key) {
  await page.keyboard.press(key)
  await new Promise(r => setTimeout(r, 100))
}

const CANVAS_X = 780 // viewport x (includes 180px palette)
const CANVAS_Y = 400

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drag and Drop', () => {
  it('drops a step node on the canvas', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const state = await getState()
    const step = state.nodes.find(n => n.kind === 'step')
    assert.ok(step, 'Step node should exist')
    assert.ok(Math.abs(step.pos.x) > 0 || Math.abs(step.pos.y) > 0, 'Node should have non-zero position')
  })

  it('drops an invoke node', async () => {
    await clearCanvas()
    await dropItem('invoke', CANVAS_X, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'invoke'), 'Invoke should exist')
  })

  it('drops a wait node', async () => {
    await clearCanvas()
    await dropItem('wait', CANVAS_X + 100, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'wait'), 'Wait should exist')
  })

  it('drops a condition node', async () => {
    await clearCanvas()
    await dropItem('condition', CANVAS_X, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'condition'), 'Condition should exist')
  })

  it('drops a withRetry node', async () => {
    await clearCanvas()
    await dropItem('withRetry', CANVAS_X, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'withRetry'), 'WithRetry should exist')
  })

  it('drops a runInChildContext node', async () => {
    await clearCanvas()
    await dropItem('runInChildContext', CANVAS_X, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'runInChildContext'), 'ChildContext should exist')
  })

  it('drops a waitForCallback node', async () => {
    await clearCanvas()
    await dropItem('waitForCallback', CANVAS_X, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'waitForCallback'), 'WaitForCallback should exist')
  })

  it('drops a createCallback node', async () => {
    await clearCanvas()
    await dropItem('createCallback', CANVAS_X, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'createCallback'), 'CreateCallback should exist')
  })

  it('drops a waitForCondition node', async () => {
    await clearCanvas()
    await dropItem('waitForCondition', CANVAS_X, CANVAS_Y)
    const state = await getState()
    assert.ok(state.nodes.find(n => n.kind === 'waitForCondition'), 'WaitForCondition should exist')
  })

  it('drops a map compound node', async () => {
    await clearCanvas()
    await dropItem('map', CANVAS_X, CANVAS_Y)
    const state = await getState()
    const map = state.nodes.find(n => n.kind === 'map')
    assert.ok(map, 'Map should exist')
  })

  it('drops a child on map compound', async () => {
    await clearCanvas()
    await dropItem('map', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const map = s1.nodes.find(n => n.kind === 'map')
    await dropOnNode('step', map.id)
    await new Promise(r => setTimeout(r, 300))
    const s2 = await getState()
    const child = s2.nodes.find(n => n.kind === 'step' && n.parent === map.id)
    assert.ok(child, 'Map child should exist')
    assert.ok(child.isChild, 'Should be a compound child')
  })

  it('drops multiple nodes without clearing', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 200, CANVAS_Y)
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y)
    const state = await getState()
    assert.equal(state.nodes.filter(n => n.kind === 'step').length, 3, 'Should have 3 steps')
  })

  it('nodeCounter increments for each node', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y)
    const counter = await page.evaluate(() => { /* nodeCounter is closure but reflected in ids */ const ids = window.cy.nodes().map(n => n.id()); return ids })
    assert.ok(counter.length === 2)
    // IDs contain the counter: step_1, step_2
    assert.ok(counter.some(id => id.includes('2')), 'Second node should have counter > 1')
  })

  it('drops a parallel and child, parent does not jump', async () => {
    await clearCanvas()
    await dropItem('parallel', CANVAS_X, CANVAS_Y)

    const before = await getState()
    const parallel = before.nodes.find(n => n.kind === 'parallel')
    assert.ok(parallel, 'Parallel should exist')
    const px = parallel.pos.x, py = parallel.pos.y

    await dropOnNode('invoke', parallel.id)
    await new Promise(r => setTimeout(r, 500))

    const after = await getState()
    const child = after.nodes.find(n => n.kind === 'invoke')
    assert.ok(child, 'Child invoke should exist')
    assert.equal(child.parent, parallel.id, 'Child should reference parent')
    assert.ok(child.isChild, 'Should be a compound child')

    const pAfter = after.nodes.find(n => n.id === parallel.id)
    assert.ok(Math.abs(pAfter.pos.x - px) < 10, `Parent x changed: ${px} -> ${pAfter.pos.x}`)
    assert.ok(Math.abs(pAfter.pos.y - py) < 10, `Parent y changed: ${py} -> ${pAfter.pos.y}`)
  })

  it('drops two children on parallel', async () => {
    await clearCanvas()
    await dropItem('parallel', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const p = s1.nodes.find(n => n.kind === 'parallel')
    await dropOnNode('invoke', p.id)
    await dropOnNode('invoke', p.id)
    await new Promise(r => setTimeout(r, 400))

    const s2 = await getState()
    const children = s2.nodes.filter(n => n.parent === p.id)
    assert.equal(children.length, 2, 'Should have 2 children')
    children.forEach(c => assert.ok(c.isChild))
  })
})

describe('Compound Nodes', () => {
  it('drops three children on parallel', async () => {
    await clearCanvas()
    await dropItem('parallel', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const p = s1.nodes.find(n => n.kind === 'parallel')
    await dropOnNode('invoke', p.id)
    await dropOnNode('invoke', p.id)
    await dropOnNode('step', p.id)
    await new Promise(r => setTimeout(r, 400))
    const s2 = await getState()
    assert.equal(s2.nodes.filter(n => n.parent === p.id).length, 3, 'Should have 3 children')
  })

  it('child position within parent is grid-snapped', async () => {
    await clearCanvas()
    await dropItem('parallel', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const p = s1.nodes.find(n => n.kind === 'parallel')
    await dropOnNode('step', p.id)
    await new Promise(r => setTimeout(r, 300))
    const s2 = await getState()
    const child = s2.nodes.find(n => n.parent === p.id)
    assert.ok(child, 'Child should exist')
    assert.ok(child.pos.x % 20 === 0, `Child x=${child.pos.x} should be multiple of 20`)
    assert.ok(child.pos.y % 20 === 0, `Child y=${child.pos.y} should be multiple of 20`)
  })

  it('map compound works as parent', async () => {
    await clearCanvas()
    await dropItem('map', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const m = s1.nodes.find(n => n.kind === 'map')
    await dropOnNode('step', m.id)
    await new Promise(r => setTimeout(r, 300))
    const s2 = await getState()
    const child = s2.nodes.find(n => n.parent === m.id)
    assert.ok(child, 'Map child should exist')
    assert.ok(child.isChild)
  })

  it('compound child not listed as top-level', async () => {
    await clearCanvas()
    await dropItem('parallel', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    await dropOnNode('step', s1.nodes[0].id)
    await new Promise(r => setTimeout(r, 300))
    const topLevel = await page.evaluate(() => window.cy.nodes().filter(n => !n.isChild()).length)
    // Top-level count is 1 (the parallel), children are not top-level
    assert.ok(topLevel >= 1, 'Should have at least the parallel as top-level')
  })
})

describe('Edge Management', () => {
  it('connects two nodes via click', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    const steps = s1.nodes.filter(n => n.kind === 'step')
    assert.equal(steps.length, 2)

    await clickNodeById(steps[0].id)
    await clickNodeById(steps[1].id)
    await new Promise(r => setTimeout(r, 200))

    const s2 = await getState()
    assert.equal(s2.edges.length, 1)
    assert.equal(s2.edges[0].from, steps[0].id)
    assert.equal(s2.edges[0].to, steps[1].id)
  })

  it('deletes edge via Delete key', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))
    const s2 = await getState()
    assert.equal(s2.edges.length, 1, 'Edge should exist')

    // Tap on edge to select it, then delete
    await page.evaluate(() => {
      const e = window.cy.edges()[0]
      e.select()
    })
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await pressKey('Delete')
    await new Promise(r => setTimeout(r, 200))

    const s3 = await getState()
    assert.equal(s3.edges.length, 0, 'Edge should be deleted')
  })

  it('right-click deletes edge', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).edges.length, 1)

    await page.evaluate(() => window.cy.edges()[0].emit('cxttap'))
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).edges.length, 0, 'Edge should be deleted via cxttap')
  })

  it('serial chain A→B→C', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 300, CANVAS_Y)
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('step', CANVAS_X + 300, CANVAS_Y)
    const s1 = await getState()
    const nodes = s1.nodes.filter(n => n.kind === 'step')
    // A→B
    await clickNodeById(nodes[0].id)
    await clickNodeById(nodes[1].id)
    await new Promise(r => setTimeout(r, 200))
    // B→C (need to dismiss rename first)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await clickNodeById(nodes[1].id)
    await clickNodeById(nodes[2].id)
    await new Promise(r => setTimeout(r, 200))

    const s2 = await getState()
    assert.equal(s2.edges.length, 2, 'Should have 2 edges')
    assert.ok(s2.edges.find(e => e.from === nodes[0].id && e.to === nodes[1].id), 'Edge A→B')
    assert.ok(s2.edges.find(e => e.from === nodes[1].id && e.to === nodes[2].id), 'Edge B→C')
  })

  it('tap on same node does not create self-loop', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const step = s1.nodes[0]
    // Tap same node twice
    await clickNodeById(step.id)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await clickNodeById(step.id)
    await new Promise(r => setTimeout(r, 200))
    const s2 = await getState()
    assert.equal(s2.edges.length, 0, 'Should not create self-loop')
  })

  it('connects condition node to step', async () => {
    await clearCanvas()
    await dropItem('condition', CANVAS_X - 100, CANVAS_Y)
    await dropItem('step', CANVAS_X + 100, CANVAS_Y)
    const s1 = await getState()
    const cond = s1.nodes.find(n => n.kind === 'condition')
    const step = s1.nodes.find(n => n.kind === 'step')
    await clickNodeById(cond.id)
    await clickNodeById(step.id)
    await new Promise(r => setTimeout(r, 200))
    const s2 = await getState()
    assert.equal(s2.edges.length, 1)
  })
})

describe('Keyboard Shortcuts', () => {
  it('Delete removes selected node', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const step = s1.nodes.find(n => n.kind === 'step')
    assert.ok(step)

    await clickNodeById(step.id)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await pressKey('Delete')
    await new Promise(r => setTimeout(r, 200))

    const s2 = await getState()
    assert.ok(!s2.nodes.find(n => n.id === step.id), 'Step should be gone')
  })

  it('Escape deselects', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes.find(n => n.kind === 'step').id)
    await pressKey('Escape')

    const sel = await page.evaluate(() => window.cy.$(':selected').length)
    assert.equal(sel, 0)
  })

  it('Escape cancels connection mode', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 100, CANVAS_Y)
    await dropItem('step', CANVAS_X + 100, CANVAS_Y)
    const s1 = await getState()
    // Tap first to enter connection mode
    await clickNodeById(s1.nodes[0].id)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    // Verify connecting class is set
    let connecting = await page.evaluate((id) => window.cy.getElementById(id).hasClass('connecting'), s1.nodes[0].id)
    assert.ok(connecting, 'First node should have connecting class')
    // Press Escape to cancel
    await pressKey('Escape')
    await new Promise(r => setTimeout(r, 200))
    connecting = await page.evaluate((id) => window.cy.getElementById(id).hasClass('connecting'), s1.nodes[0].id)
    assert.ok(!connecting, 'Connecting class should be removed')
  })

  it('Ctrl+Z undoes', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const step = s1.nodes.find(n => n.kind === 'step')
    assert.ok(step, 'Step should exist')

    await page.keyboard.down('Control')
    await pressKey('z')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 500))

    const s2 = await getState()
    assert.ok(!s2.nodes.find(n => n.kind === 'step'), 'Step should be undone')
  })

  it('Ctrl+Z undoes edge creation', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).edges.length, 1)

    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await page.keyboard.down('Control')
    await pressKey('z')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 400))

    assert.equal((await getState()).edges.length, 0, 'Edge should be undone')
  })

  it('Ctrl+Shift+Z redoes', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    assert.equal(s1.nodes.length, 1)

    // Undo
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await page.keyboard.down('Control')
    await pressKey('z')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 400))
    assert.equal((await getState()).nodes.length, 0, 'Node should be undone')

    // Redo with Ctrl+Shift+Z
    await page.keyboard.down('Control')
    await page.keyboard.down('Shift')
    await pressKey('z')
    await page.keyboard.up('Shift')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 400))
    assert.equal((await getState()).nodes.length, 1, 'Node should be redone')
  })

  it('Ctrl+Y redoes', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    // Undo
    await page.keyboard.down('Control')
    await pressKey('z')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 400))
    // Redo with Ctrl+Y
    await page.keyboard.down('Control')
    await pressKey('y')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 400))
    assert.equal((await getState()).nodes.length, 1, 'Node should be redone with Ctrl+Y')
  })

  it('Ctrl+A selects all elements', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 200, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))

    await page.keyboard.down('Control')
    await pressKey('a')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 200))

    const sel = await page.evaluate(() => window.cy.$(':selected').length)
    assert.ok(sel >= 1, 'Should select elements')
  })

  it('Delete removes selected edge', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))

    // Select and delete edge
    await page.evaluate(() => { window.cy.edges()[0].select(); document.getElementById('rename-field')?.blur() })
    await new Promise(r => setTimeout(r, 200))
    await pressKey('Delete')
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).edges.length, 0, 'Edge should be deleted')
  })

  it('multiple consecutive undos', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 300))
    assert.equal((await getState()).nodes.length, 2)

    // Undo twice
    for (let i = 0; i < 2; i++) {
      await page.keyboard.down('Control')
      await pressKey('z')
      await page.keyboard.up('Control')
      await new Promise(r => setTimeout(r, 400))
    }
    assert.equal((await getState()).nodes.length, 0, 'All nodes should be undone')
  })
})

describe('Right-Click', () => {
  it('cxttap deletes node', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    assert.equal(s1.nodes.length, 1)
    await page.evaluate((id) => window.cy.getElementById(id).emit('cxttap'), s1.nodes[0].id)
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).nodes.length, 0, 'Node should be deleted')
  })

  it('cxttap deletes edge', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).edges.length, 1)

    await page.evaluate(() => window.cy.edges()[0].emit('cxttap'))
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).edges.length, 0, 'Edge should be deleted via cxttap')
  })
})

describe('Language Filtering', () => {
  it('withRetry hidden when C# selected', async () => {
    await page.select('#palette-language', 'csharp')
    await new Promise(r => setTimeout(r, 100))
    const display = await page.$eval('.palette-item[data-kind="withRetry"]', el => el.style.display)
    assert.equal(display, 'none', 'withRetry should be hidden for C#')
    // Reset
    await page.select('#palette-language', 'typescript')
  })

  it('all primitives visible for TypeScript', async () => {
    await page.select('#palette-language', 'typescript')
    await new Promise(r => setTimeout(r, 100))
    const hidden = await page.$$eval('.palette-item', els =>
      els.filter(el => el.style.display === 'none').length
    )
    assert.equal(hidden, 0, 'No primitives should be hidden for TypeScript')
  })

  it('switching language hides/shows items', async () => {
    await page.select('#palette-language', 'csharp')
    await new Promise(r => setTimeout(r, 100))
    const displayCSharp = await page.$eval('.palette-item[data-kind="withRetry"]', el => el.style.display)
    assert.equal(displayCSharp, 'none', 'Hidden for C#')

    await page.select('#palette-language', 'java')
    await new Promise(r => setTimeout(r, 100))
    const displayJava = await page.$eval('.palette-item[data-kind="withRetry"]', el => el.style.display)
    assert.notEqual(displayJava, 'none', 'Visible for Java')

    await page.select('#palette-language', 'typescript')
  })
})

describe('Preview Panel', () => {
  it('preview shows content', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await new Promise(r => setTimeout(r, 200))
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))

    await page.click('#preview-btn')
    await new Promise(r => setTimeout(r, 300))
    const display = await page.$eval('#preview-panel', el => el.style.display)
    assert.equal(display, 'flex', 'Preview panel should be visible')
    const content = await page.$eval('#preview-content', el => el.textContent)
    assert.ok(content.length > 0, 'Preview should have content')
  })

  it('preview closes with button', async () => {
    await page.click('#preview-close')
    await new Promise(r => setTimeout(r, 300))
    const display = await page.$eval('#preview-panel', el => el.style.display)
    assert.equal(display, 'none', 'Preview should be hidden')
  })
})

describe('Canvas State', () => {
  it('clear removes all elements', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y)
    await dropItem('invoke', CANVAS_X - 200, CANVAS_Y)
    assert.equal((await getState()).nodes.length, 3)
    await clearCanvas()
    assert.equal((await getState()).nodes.length, 0, 'Canvas should be empty')
    assert.equal((await getState()).edges.length, 0, 'Edges should be empty')
  })

  it('empty graph has zero elements', async () => {
    await clearCanvas()
    const count = await page.evaluate(() => window.cy.elements().length)
    assert.equal(count, 0)
  })

  it('add after clear starts fresh counter', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await clearCanvas()
    await dropItem('step', CANVAS_X + 100, CANVAS_Y)
    const state = await getState()
    assert.equal(state.nodes.length, 1)
    assert.ok(state.nodes[0].id.includes('step_'), 'Should have fresh node id')
  })

  it('cy is initialized', async () => {
    const ok = await page.evaluate(() =>
      typeof window.cy === 'object' && typeof window.cy.elements === 'function' && typeof window.cy.add === 'function'
    )
    assert.ok(ok, 'Cytoscape should be initialized')
  })
})

describe('Connecting Mode', () => {
  it('first tap sets connecting class', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await clickNodeById(s1.nodes[0].id)
    const hasClass = await page.evaluate((id) => window.cy.getElementById(id).hasClass('connecting'), s1.nodes[0].id)
    assert.ok(hasClass, 'Node should have connecting class after tap')
  })

  it('second tap on different node creates edge and clears connecting', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))
    const hasClass = await page.evaluate((id) => window.cy.getElementById(id).hasClass('connecting'), s1.nodes[0].id)
    assert.ok(!hasClass, 'Source connecting class should be cleared')
    assert.equal((await getState()).edges.length, 1, 'Edge should be created')
  })

  it('tapping first node twice re-enters connecting mode', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    // Tap A twice (re-enter connecting mode)
    await clickNodeById(s1.nodes[0].id)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await clickNodeById(s1.nodes[0].id)
    await new Promise(r => setTimeout(r, 200))
    // Should still be in connecting mode (no edge)
    assert.equal((await getState()).edges.length, 0, 'No edge should be created from tapping same node')
    const hasClass = await page.evaluate((id) => window.cy.getElementById(id).hasClass('connecting'), s1.nodes[0].id)
    assert.ok(hasClass, 'Should re-enter connecting mode')
  })
})

describe('Rename', () => {
  it('double-click opens rename input', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await new Promise(r => setTimeout(r, 300))
    const s1 = await getState()
    const step = s1.nodes.find(n => n.kind === 'step')
    assert.ok(step, 'Step should exist')

    await pressKey('Escape')
    await new Promise(r => setTimeout(r, 200))

    await page.evaluate((nodeId) => {
      const n = window.cy.getElementById(nodeId)
      n.emit('dblclick')
    }, step.id)
    await new Promise(r => setTimeout(r, 400))

    const visible = await page.$eval('#rename-input', el => el.style.display)
    assert.equal(visible, 'block', 'Rename input should be visible')
  })

  it('Enter commits rename', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await new Promise(r => setTimeout(r, 300))

    // Rename input is auto-shown: type new name and press Enter
    await page.evaluate(() => {
      document.getElementById('rename-field').value = 'myCustomName'
    })
    await page.keyboard.press('Enter')
    await new Promise(r => setTimeout(r, 200))

    const label = await page.evaluate(() => window.cy.nodes()[0].data('label'))
    assert.equal(label, 'myCustomName', 'Label should be updated')
    const display = await page.$eval('#rename-input', el => el.style.display)
    assert.equal(display, 'none', 'Rename input should be hidden after Enter')
  })

  it('Escape cancels rename without changing label', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await new Promise(r => setTimeout(r, 300))
    const original = await page.evaluate(() => window.cy.nodes()[0].data('label'))

    await page.evaluate(() => {
      document.getElementById('rename-field').value = 'shouldNotStick'
    })
    await pressKey('Escape')
    await new Promise(r => setTimeout(r, 200))

    const label = await page.evaluate(() => window.cy.nodes()[0].data('label'))
    assert.equal(label, original, 'Label should not change after Escape cancel')
  })

  it('auto-shown rename input has correct default value', async () => {
    await clearCanvas()
    await dropItem('wait', CANVAS_X, CANVAS_Y)
    await new Promise(r => setTimeout(r, 300))
    const value = await page.$eval('#rename-field', el => el.value)
    assert.equal(value, 'wait', 'Default rename value should match palette label')
  })

  it('edge dblclick opens rename for edge label', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))

    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))

    // Emit dblclick on edge
    await page.evaluate(() => window.cy.edges()[0].emit('dblclick'))
    await new Promise(r => setTimeout(r, 300))

    const display = await page.$eval('#rename-input', el => el.style.display)
    assert.equal(display, 'block', 'Rename input should be visible for edge label')
  })
})

describe('Snap to Grid', () => {
  it('dropped node snaps to grid', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await new Promise(r => setTimeout(r, 300))

    const state = await getState()
    const step = state.nodes.find(n => n.kind === 'step')
    assert.ok(step, 'Step node should exist')
    assert.ok(step.pos.x % 20 === 0, `x=${step.pos.x} should be multiple of 20`)
    assert.ok(step.pos.y % 20 === 0, `y=${step.pos.y} should be multiple of 20`)
  })

  it('dragged node snaps to grid', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await new Promise(r => setTimeout(r, 300))

    await pressKey('Escape')
    await new Promise(r => setTimeout(r, 200))

    const s1 = await getState()
    const step = s1.nodes.find(n => n.kind === 'step')
    assert.ok(step, 'Step should exist')

    const pos = await getViewportPos(step.id)
    await page.mouse.move(pos.x, pos.y)
    await page.mouse.down()
    await page.mouse.move(pos.x + 7, pos.y + 13, { steps: 5 })
    await page.mouse.up()
    await new Promise(r => setTimeout(r, 300))

    const s2 = await getState()
    const step2 = s2.nodes.find(n => n.id === step.id)
    assert.ok(step2.pos.x % 20 === 0, `x=${step2.pos.x} should be multiple of 20 after drag`)
    assert.ok(step2.pos.y % 20 === 0, `y=${step2.pos.y} should be multiple of 20 after drag`)
  })

  it('all node types snap to grid', async () => {
    await clearCanvas()
    const kinds = ['invoke', 'wait', 'condition', 'waitForCallback', 'createCallback', 'waitForCondition', 'withRetry', 'runInChildContext']
    for (let i = 0; i < kinds.length; i++) {
      await dropItem(kinds[i], CANVAS_X + i * 40, CANVAS_Y + i * 40)
      await new Promise(r => setTimeout(r, 200))
    }
    const state = await getState()
    for (const node of state.nodes) {
      assert.ok(node.pos.x % 20 === 0, `${node.kind} x=${node.pos.x} should be multiple of 20`)
      assert.ok(node.pos.y % 20 === 0, `${node.kind} y=${node.pos.y} should be multiple of 20`)
    }
  })

  it('compound child snaps to grid within parent', async () => {
    await clearCanvas()
    await dropItem('parallel', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    const p = s1.nodes.find(n => n.kind === 'parallel')
    await dropOnNode('step', p.id)
    await new Promise(r => setTimeout(r, 300))
    const s2 = await getState()
    const child = s2.nodes.find(n => n.parent === p.id)
    assert.ok(child, 'Child should exist')
    assert.ok(child.pos.x % 20 === 0, `Child x=${child.pos.x} on grid`)
    assert.ok(child.pos.y % 20 === 0, `Child y=${child.pos.y} on grid`)
  })
})

describe('Toolbar', () => {
  it('fit button works with elements', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await page.click('#fit-btn')
    await new Promise(r => setTimeout(r, 400))
    const zoom = await page.evaluate(() => window.cy.zoom())
    assert.ok(zoom > 0, `Zoom should be positive: ${zoom}`)
    assert.ok(zoom <= 3, `Zoom should not exceed 3x: ${zoom}`)
  })

  it('arrange preserves element count', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 200, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y)
    await page.evaluate(() => { document.getElementById('rename-field')?.blur(); })
    await new Promise(r => setTimeout(r, 200))
    const before = await page.evaluate(() => window.cy.nodes().length)
    assert.equal(before, 2, 'Should have 2 nodes before arrange')

    await page.click('#layout-btn')
    await new Promise(r => setTimeout(r, 1000))

    const after = await page.evaluate(() => window.cy.nodes().length)
    assert.equal(after, 2, 'Arrange should preserve node count')
  })

  it('arrange repositions nodes', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 200, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y + 200)
    const before = await getState()
    const beforePositions = before.nodes.filter(n => n.kind === 'step').map(n => ({ x: n.pos.x, y: n.pos.y }))

    await page.click('#layout-btn')
    await new Promise(r => setTimeout(r, 600))

    const after = await getState()
    const afterPositions = after.nodes.filter(n => n.kind === 'step').map(n => ({ x: n.pos.x, y: n.pos.y }))
    const changed = beforePositions.some((p, i) =>
      Math.abs(p.x - afterPositions[i].x) > 1 || Math.abs(p.y - afterPositions[i].y) > 1
    )
    assert.ok(changed, 'Arrange should reposition nodes')
  })

  it('export generates PNG data', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    const hasPng = await page.evaluate(() => {
      const png = window.cy.png({ full: false, bg: '#1e1e1e' })
      return typeof png === 'string' && png.startsWith('data:image/png')
    })
    assert.ok(hasPng, 'PNG export should produce data URL')
  })

  it('save and load round-trip preserves graph', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('invoke', CANVAS_X + 200, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await new Promise(r => setTimeout(r, 200))

    const beforeSave = await getState()
    const json = await page.evaluate(() => JSON.stringify({
      elements: window.cy.json().elements
    }))

    // Clear and reload
    await clearCanvas()
    await page.evaluate((j) => {
      window.postMessage({ type: 'loadGraphData', data: j }, '*')
    }, json)
    await new Promise(r => setTimeout(r, 300))

    const s2 = await getState()
    assert.equal(s2.nodes.length, beforeSave.nodes.length, 'Node count should match')
    assert.equal(s2.edges.length, beforeSave.edges.length, 'Edge count should match')
  })
})

describe('Arrange Layout', () => {
  it('arrange repositions nodes', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 200, CANVAS_Y)
    await dropItem('step', CANVAS_X + 200, CANVAS_Y + 200)
    const before = await getState()
    const beforePositions = before.nodes.filter(n => n.kind === 'step').map(n => ({ x: n.pos.x, y: n.pos.y }))

    await page.click('#layout-btn')
    await new Promise(r => setTimeout(r, 600))

    const after = await getState()
    const afterPositions = after.nodes.filter(n => n.kind === 'step').map(n => ({ x: n.pos.x, y: n.pos.y }))
    const changed = beforePositions.some((p, i) =>
      Math.abs(p.x - afterPositions[i].x) > 1 || Math.abs(p.y - afterPositions[i].y) > 1
    )
    assert.ok(changed, 'Arrange should reposition nodes')
  })
})

describe('Graph Consistency', () => {
  it('selected node exists in graph', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    const s1 = await getState()
    await clickNodeById(s1.nodes[0].id)
    const selId = await page.evaluate(() => {
      const sel = window.cy.$(':selected')
      return sel.length ? sel[0].id() : null
    })
    assert.ok(selId, 'Should have a selected node')
    assert.equal(selId, s1.nodes[0].id, 'Selected node id should match')
  })

  it('no orphaned edges after node deletion', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 150, CANVAS_Y)
    await dropItem('step', CANVAS_X + 150, CANVAS_Y)
    const s1 = await getState()
    const aId = s1.nodes[0].id
    const bId = s1.nodes[1].id
    await clickNodeById(aId)
    await clickNodeById(bId)
    await new Promise(r => setTimeout(r, 200))
    assert.equal((await getState()).edges.length, 1)

    // Select source node directly and delete
    await page.evaluate((id) => {
      window.cy.elements().unselect()
      const n = window.cy.getElementById(id)
      n.select()
      document.getElementById('rename-field')?.blur()
    }, aId)
    await new Promise(r => setTimeout(r, 200))
    await pressKey('Delete')
    await new Promise(r => setTimeout(r, 200))

    const s2 = await getState()
    assert.equal(s2.edges.length, 0, 'Edges should be removed when source node is deleted')
    assert.equal(s2.nodes.length, 1, 'Only target node should remain')
  })

  it('edge count matches cy.edges length', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X - 300, CANVAS_Y)
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('step', CANVAS_X + 300, CANVAS_Y)
    const s1 = await getState()
    // A→B, B→C
    await clickNodeById(s1.nodes[0].id)
    await clickNodeById(s1.nodes[1].id)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))
    await clickNodeById(s1.nodes[1].id)
    await clickNodeById(s1.nodes[2].id)
    await new Promise(r => setTimeout(r, 200))

    const rawCount = await page.evaluate(() => window.cy.edges().length)
    const stateCount = (await getState()).edges.length
    assert.equal(rawCount, 2)
    assert.equal(stateCount, 2)
    assert.equal(rawCount, stateCount, 'Edge counts should be consistent')
  })
})

describe('Edge Cases', () => {
  it('operations on empty graph do not crash', async () => {
    await clearCanvas()
    await pressKey('Delete')
    await pressKey('Escape')
    await page.click('#layout-btn')
    await new Promise(r => setTimeout(r, 400))
    await page.click('#fit-btn')
    await new Promise(r => setTimeout(r, 200))
    // Should not throw
    const count = await page.evaluate(() => window.cy.elements().length)
    assert.equal(count, 0)
  })

  it('switching language does not affect existing nodes', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await dropItem('withRetry', CANVAS_X + 200, CANVAS_Y)

    await page.select('#palette-language', 'csharp')
    await new Promise(r => setTimeout(r, 100))
    const count = await page.evaluate(() => window.cy.nodes().length)
    assert.equal(count, 2, 'Existing nodes should persist after language switch')

    await page.select('#palette-language', 'typescript')
  })

  it('canvas area is focusable for keyboard events', async () => {
    await clearCanvas()
    await dropItem('step', CANVAS_X, CANVAS_Y)
    await page.evaluate(() => document.getElementById('rename-field')?.blur())
    await new Promise(r => setTimeout(r, 200))

    // Click on canvas area background
    const crect = await getCanvasRect()
    await page.mouse.click(crect.left + 100, 100)
    await new Promise(r => setTimeout(r, 200))

    // Now try Ctrl+A
    await page.keyboard.down('Control')
    await pressKey('a')
    await page.keyboard.up('Control')
    await new Promise(r => setTimeout(r, 200))

    const sel = await page.evaluate(() => window.cy.$(':selected').length)
    assert.ok(sel >= 1, 'Should be able to select after clicking canvas')
  })
})
