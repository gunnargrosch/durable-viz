import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { PythonParser } from './python.js'

const parser = new PythonParser()
const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')

describe('PythonParser', () => {
  it('parses the order processor example', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor.py'))

    assert.equal(graph.name, 'order_processor')

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('start'))
    assert.ok(kinds.includes('end'))
    assert.ok(kinds.includes('step'))
    assert.ok(kinds.includes('wait'))
    assert.ok(kinds.includes('createCallback'))
    assert.ok(kinds.includes('condition'))
  })

  it('extracts step names from name= arguments', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor.py'))

    const stepLabels = graph.nodes
      .filter((n) => n.kind === 'step')
      .map((n) => n.label)

    assert.ok(stepLabels.includes('validate_order'))
    assert.ok(stepLabels.includes('process_payment'))
    assert.ok(stepLabels.includes('send_confirmation'))
  })

  it('follows helper functions with DurableContext', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor.py'))

    const invoke = graph.nodes.find((n) => n.kind === 'invoke')
    assert.ok(invoke, 'Should find invoke from fulfill_order helper')
    // The invoke label comes from function_name= or name= argument
    assert.ok(invoke.label.length > 0)
  })

  it('detects condition with create_callback', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor.py'))

    const condition = graph.nodes.find((n) => n.kind === 'condition')
    assert.ok(condition)

    const callback = graph.nodes.find((n) => n.kind === 'createCallback')
    assert.ok(callback)
    assert.equal(callback.label, 'manager_approval')
  })

  it('includes source line numbers', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor.py'))

    const nodesWithLines = graph.nodes.filter((n) => n.sourceLine != null)
    assert.ok(nodesWithLines.length >= 4, `Expected at least 4 nodes with source lines, got ${nodesWithLines.length}`)
  })

  it('generates valid edges', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor.py'))

    assert.ok(graph.edges.length > 0)

    const startEdges = graph.edges.filter((e) => e.from === 'node_start')
    assert.equal(startEdges.length, 1)

    const endEdges = graph.edges.filter((e) => e.to === 'node_end')
    assert.ok(endEdges.length >= 1)
  })

  it('throws for non-durable files', () => {
    assert.throws(
      () => parser.parseFile(resolve(examplesDir, 'OrderProcessor.java')),
      /No @durable_execution/
    )
  })
})
