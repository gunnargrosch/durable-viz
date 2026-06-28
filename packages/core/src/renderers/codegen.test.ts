import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { generateCode } from './codegen.js'
import { parseFile } from '../parser.js'

const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')

describe('generateCode', () => {
  it('generates TypeScript from order workflow', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    assert.ok(code.includes("export const handler = withDurableExecution"), 'Should generate handler')
    assert.ok(code.includes("'validate-order'"), 'Should include step names')
    assert.ok(code.includes("context.parallel"), 'Should generate parallel')

    // Should not contain start/end nodes
    assert.ok(!code.includes('node_start'), 'Should not contain meta node IDs')
    assert.ok(!code.includes('node_end'), 'Should not contain meta node IDs')
  })

  it('generates if/else from condition node', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    assert.ok(code.includes('if ('), 'Should generate if-statement')
    assert.ok(code.includes('} else {'), 'Should generate else-branch')
  })

  it('generates Python from order processor', () => {
    const graph = parseFile(resolve(examplesDir, 'order_processor.py'))
    const code = generateCode(graph, { language: 'python' })

    assert.ok(code.includes('@durable_execution'), 'Should generate decorator')
    assert.ok(code.includes('def handler'), 'Should generate handler function')
    assert.ok(code.includes('"validate_order"'), 'Should include step names')
    assert.ok(code.includes('context.step'), 'Should generate steps')
  })

  it('generates Java from OrderProcessor', () => {
    const graph = parseFile(resolve(examplesDir, 'OrderProcessor.java'))
    const code = generateCode(graph, { language: 'java' })

    assert.ok(code.includes('extends DurableHandler'), 'Should generate class')
    assert.ok(code.includes('handleRequest'), 'Should generate method')
    assert.ok(code.includes('"validate-order"'), 'Should include step names')
    assert.ok(code.includes('ctx.step'), 'Should generate steps')
  })

  it('generates ts code without start/end in variable names', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    const nodeIds = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end').map((n) => n.id)
    for (const id of nodeIds) {
      assert.ok(!code.includes(id), `Should not include raw node ID ${id}`)
    }
  })

  it('includes TODO comments for each primitive', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    const todos = (code.match(/\/\/ TODO/g) ?? []).length
    assert.ok(todos >= 3, `Expected at least 3 TODO comments, got ${todos}`)
  })
})
