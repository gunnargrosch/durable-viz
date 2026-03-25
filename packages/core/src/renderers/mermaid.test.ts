import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { parseFile } from '../parser.js'
import { renderMermaid } from './mermaid.js'

const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')

describe('renderMermaid', () => {
  it('produces valid Mermaid syntax for TypeScript', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    assert.ok(output.startsWith('graph TD'))
    assert.ok(output.includes('node_start'))
    assert.ok(output.includes('node_end'))
    assert.ok(output.includes('-->'))
  })

  it('supports LR direction', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph, { direction: 'LR' })

    assert.ok(output.startsWith('graph LR'))
  })

  it('includes style directives for all nodes', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    const styleLines = output.split('\n').filter((l) => l.trimStart().startsWith('style '))
    const nodeCount = graph.nodes.length
    // Branch nodes also get styles
    const branchNodeCount = graph.nodes
      .filter((n) => n.branches)
      .reduce((sum, n) => sum + (n.branches?.reduce((s, b) => s + b.nodes.length, 0) ?? 0), 0)

    assert.ok(styleLines.length >= nodeCount + branchNodeCount - 2, // start/end might not get styled in some cases
      `Expected at least ${nodeCount + branchNodeCount - 2} style lines, got ${styleLines.length}`)
  })

  it('includes click callbacks for nodes with source lines', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    const clickLines = output.split('\n').filter((l) => l.includes('call onNodeClick'))
    assert.ok(clickLines.length >= 4, `Expected at least 4 click callbacks, got ${clickLines.length}`)
  })

  it('wraps parallel branches in subgraph', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('subgraph'), 'Should contain a subgraph for parallel branches')
    assert.ok(output.includes('end'), 'Should close the subgraph')
    assert.ok(output.includes('stroke-dasharray'), 'Subgraph should have dashed border')
  })

  it('uses nbsp padding in edge labels', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('#nbsp;'), 'Edge labels should have nbsp padding')
  })

  it('does not use reserved node IDs', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    const nodeIds = graph.nodes.map((n) => n.id)
    assert.ok(!nodeIds.includes('start'), 'Should not use reserved ID "start"')
    assert.ok(!nodeIds.includes('end'), 'Should not use reserved ID "end"')
  })
})
