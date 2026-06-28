import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { CSharpParser } from './csharp.js'

const parser = new CSharpParser()
const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')
const fixturesDir = resolve(import.meta.dirname, '../../../..', 'packages/core/test-fixtures')

describe('CSharpParser', () => {
  it('parses the OrderWorkflow example (executable model)', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderWorkflow.cs'))

    assert.equal(graph.name, 'OrderWorkflow')

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('start'))
    assert.ok(kinds.includes('end'))
    assert.ok(kinds.includes('step'))
    assert.ok(kinds.includes('parallel'))
    assert.ok(kinds.includes('wait'))
    assert.ok(kinds.includes('waitForCallback'))
    assert.ok(kinds.includes('condition'))
  })

  it('parses the OrderProcessor example (class-library model)', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.cs'))

    assert.equal(graph.name, 'OrderProcessor')

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('start'))
    assert.ok(kinds.includes('end'))
    assert.ok(kinds.includes('step'))
    assert.ok(kinds.includes('parallel'))
    assert.ok(kinds.includes('wait'))
    assert.ok(kinds.includes('waitForCallback'))
    assert.ok(kinds.includes('invoke'))
    assert.ok(kinds.includes('condition'))
  })

  it('extracts step names from named arguments', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderWorkflow.cs'))

    const stepLabels = graph.nodes
      .filter((n) => n.kind === 'step')
      .map((n) => n.label)

    assert.ok(stepLabels.includes('validate-order'))
    assert.ok(stepLabels.includes('fulfill-order'))
  })

  it('extracts parallel branch names', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderWorkflow.cs'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel)
    assert.equal(parallel.label, 'prepare-order')
    assert.ok(parallel.branches)
    assert.equal(parallel.branches.length, 2)

    const branchNames = parallel.branches.map((b) => b.name)
    assert.ok(branchNames.includes('check-inventory'))
    assert.ok(branchNames.includes('reserve-payment'))
  })

  it('extracts wait name', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderWorkflow.cs'))

    const wait = graph.nodes.find((n) => n.kind === 'wait')
    assert.ok(wait)
    assert.equal(wait.label, 'warehouse-processing')
  })

  it('detects condition nodes', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderWorkflow.cs'))

    const condition = graph.nodes.find((n) => n.kind === 'condition')
    assert.ok(condition)
    assert.ok(condition.condition?.includes('Total > 5000'))
    assert.ok(condition.thenCount)
  })

  it('extracts waitForCallback name', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderWorkflow.cs'))

    const callback = graph.nodes.find((n) => n.kind === 'waitForCallback')
    assert.ok(callback)
    assert.equal(callback.label, 'manager-approval')
  })

  it('extracts invoke target', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.cs'))

    const invoke = graph.nodes.find((n) => n.kind === 'invoke')
    assert.ok(invoke)
    assert.equal(invoke.label, 'fulfillment-service')
    assert.equal(invoke.target, 'fulfillment-service')
  })

  it('includes source line numbers', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.cs'))

    const nodesWithLines = graph.nodes.filter((n) => n.sourceLine != null)
    assert.ok(nodesWithLines.length >= 5, `Expected at least 5 nodes with source lines, got ${nodesWithLines.length}`)
  })

  it('generates valid edges', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.cs'))

    assert.ok(graph.edges.length > 0)

    const startEdges = graph.edges.filter((e) => e.from === 'node_start')
    assert.equal(startEdges.length, 1)

    const endEdges = graph.edges.filter((e) => e.to === 'node_end')
    assert.ok(endEdges.length >= 1)
  })

  it('throws for non-durable files', () => {
    assert.throws(
      () => parser.parseFile(resolve(examplesDir, 'order_processor.py')),
      /No DurableFunction\.WrapAsync/
    )
  })

  it('parses WaitAsync with TimeSpan argument', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.cs'))

    const wait = graph.nodes.find((n) => n.kind === 'wait')
    assert.ok(wait)
    assert.equal(wait.label, 'shipping-delay')
  })

  it('parses CreateCallbackAsync with generic type arg', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'CreateCallback.cs'))

    const cb = graph.nodes.find((n) => n.kind === 'createCallback')
    assert.ok(cb, 'Should detect CreateCallbackAsync')
  })

  it('parses WaitForConditionAsync with named args', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'WaitForCondition.cs'))

    const wfc = graph.nodes.find((n) => n.kind === 'waitForCondition')
    assert.ok(wfc, 'Should detect WaitForConditionAsync')
    assert.equal(wfc.label, 'happy_poll')
  })

  it('parses RunInChildContextAsync', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'ChildContext.cs'))

    const child = graph.nodes.find((n) => n.kind === 'runInChildContext')
    assert.ok(child, 'Should detect RunInChildContextAsync')
  })

  it('parses MapAsync', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'MapFunction.cs'))

    const map = graph.nodes.find((n) => n.kind === 'map')
    assert.ok(map, 'Should detect MapAsync')
    assert.equal(map.label, 'process')
  })
})
