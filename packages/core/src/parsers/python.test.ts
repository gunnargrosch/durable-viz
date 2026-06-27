import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { PythonParser } from './python.js'

const parser = new PythonParser()
const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')
const fixturesDir = resolve(import.meta.dirname, '../../../..', 'packages/core/test-fixtures')

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

  it('detects with_retry', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor_with_retry.py'))

    const withRetry = graph.nodes.find((n) => n.kind === 'withRetry')
    assert.ok(withRetry, 'Should detect with_retry')
    assert.equal(withRetry.label, 'retry-fulfillment')
  })

  it('extracts step_semantics from StepConfig', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor_with_retry.py'))

    const step = graph.nodes.find((n) => n.kind === 'step' && n.label === 'validate_order')
    assert.ok(step, 'Should find validate_order step')
    assert.equal(step.stepSemantics, 'AtMostOncePerRetry')
  })

  it('extracts nesting_type from parallel config', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor_with_retry.py'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel, 'Should find parallel node')
    assert.equal(parallel.nestingType, 'FLAT')
  })

  it('extracts completion_config from parallel config', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor_with_retry.py'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel, 'Should find parallel node')
    assert.equal(parallel.completionConfig, 'first successful')
  })

  it('extracts tenant_id from invoke config', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor_with_retry.py'))

    const invoke = graph.nodes.find((n) => n.kind === 'invoke')
    assert.ok(invoke, 'Should find invoke node')
    assert.equal(invoke.tenantId, 'tenant-abc-123')
  })

  it('extracts nesting_type from map config', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_processor_with_retry.py'))

    const map = graph.nodes.find((n) => n.kind === 'map')
    assert.ok(map, 'Should find map node')
    assert.equal(map.nestingType, 'FLAT')
    assert.equal(map.completionConfig, 'all completed')
  })

  it('extracts step name from function reference (no name=)', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'dynamic-names.py'))
    const labels = graph.nodes.map((n) => n.label)
    assert.ok(labels.includes('do_work'), 'Should extract function name do_work')
  })

  it('prefers explicit name= over function reference', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'dynamic-names.py'))
    const labels = graph.nodes.map((n) => n.label)
    assert.ok(labels.includes('explicit-name'), 'Should use explicit-name when name= is a string')
  })

  it('prefers function reference over unresolved variable name=', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'dynamic-names.py'))
    const labels = graph.nodes.map((n) => n.label)
    // context.step(do_work(...), name=comp_name) → function ref do_work beats unresolved variable comp_name
    assert.ok(labels.includes('do_work'), 'Function ref should take priority over variable name=')
  })

  it('extracts step names from multi-line calls', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'multiline-names.py'))
    const labels = graph.nodes.map((n) => n.label)
    assert.ok(labels.includes('validate_order'), 'Should extract name from multi-line call')
    assert.ok(labels.includes('process_payment'), 'Should extract name from multi-line call')
  })
})
