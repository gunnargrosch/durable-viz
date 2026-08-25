import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { RustParser } from './rust.js'

const parser = new RustParser()
const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')
const fixturesDir = resolve(import.meta.dirname, '../../../..', 'packages/core/test-fixtures')

describe('RustParser', () => {
  it('parses the order_workflow example (named fn entry point)', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    assert.equal(graph.name, 'order_workflow')

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('start'))
    assert.ok(kinds.includes('end'))
    assert.ok(kinds.includes('step'))
    assert.ok(kinds.includes('parallel'))
    assert.ok(kinds.includes('wait'))
    assert.ok(kinds.includes('waitForCallback'))
    assert.ok(kinds.includes('condition'))
  })

  it('extracts step names from the builder chain', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    const stepLabels = graph.nodes.filter((n) => n.kind === 'step').map((n) => n.label)
    assert.ok(stepLabels.includes('validate-order'))
    assert.ok(stepLabels.includes('ship-order'))
  })

  it('extracts parallel branch names from Branch::new', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel)
    assert.equal(parallel.label, 'prepare-order')
    assert.ok(parallel.branches)
    assert.equal(parallel.branches.length, 2)

    const branchNames = parallel.branches.map((b) => b.name)
    assert.ok(branchNames.includes('check-inventory'))
    assert.ok(branchNames.includes('reserve-payment'))
  })

  it('extracts max_concurrency from parallel/map', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel)
    assert.equal(parallel.maxConcurrency, 2)
  })

  it('extracts wait name', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    const wait = graph.nodes.find((n) => n.kind === 'wait')
    assert.ok(wait)
    assert.equal(wait.label, 'warehouse-processing')
  })

  it('extracts wait_for_callback name', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    const callback = graph.nodes.find((n) => n.kind === 'waitForCallback')
    assert.ok(callback)
    assert.equal(callback.label, 'manager-approval')
  })

  it('detects condition nodes', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    const condition = graph.nodes.find((n) => n.kind === 'condition')
    assert.ok(condition)
    assert.ok(condition.condition?.includes('validated.is_some()'))
    assert.equal(condition.thenCount, 1)
  })

  it('includes source line numbers', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    const nodesWithLines = graph.nodes.filter((n) => n.sourceLine != null)
    assert.ok(nodesWithLines.length >= 5, `Expected at least 5 nodes with source lines, got ${nodesWithLines.length}`)
  })

  it('generates valid edges', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.rs'))

    assert.ok(graph.edges.length > 0)

    const startEdges = graph.edges.filter((e) => e.from === 'node_start')
    assert.equal(startEdges.length, 1)

    const endEdges = graph.edges.filter((e) => e.to === 'node_end')
    assert.ok(endEdges.length >= 1)
  })

  it('parses inline closure entry points and combinator calls', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'rust_combinators.rs'))

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('step'))
    assert.ok(kinds.includes('promiseRace'))
  })

  it('falls back to the variable name when .name(&var) is not resolvable', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'rust_combinators.rs'))

    const steps = graph.nodes.filter((n) => n.kind === 'step')
    const labels = steps.map((s) => s.label)
    assert.ok(labels.includes('name'))
    assert.ok(labels.includes('second'))
  })

  it('resolves a local string constant for .name(ident)', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'rust_const_name.rs'))

    const step = graph.nodes.find((n) => n.kind === 'step')
    assert.ok(step)
    assert.equal(step.label, 'hello-world')
  })

  it('extracts step semantics and retry strategy', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'rust_const_name.rs'))

    const step = graph.nodes.find((n) => n.kind === 'step')
    assert.ok(step)
    assert.equal(step.stepSemantics, 'AtMostOncePerRetry')
    assert.equal(step.retryStrategy, 'retry_strategy')
  })

  it('throws for non-durable files', () => {
    assert.throws(
      () => parser.parseFile(resolve(examplesDir, 'order_processor.py')),
      /No .*run\(\) entry point/
    )
  })

  it('parses the order_workflow_config example (all primitives + config)', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.rs'))

    const kinds = graph.nodes.map((n) => n.kind)
    for (const expected of ['step', 'map', 'invoke', 'runInChildContext', 'withRetry', 'waitForCondition', 'createCallback', 'promiseRace'] as const) {
      assert.ok(kinds.includes(expected), `Expected kind ${expected}`)
    }
  })

  it('extracts config features from the order_workflow_config example', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.rs'))

    const map = graph.nodes.find((n) => n.kind === 'map')
    assert.ok(map)
    assert.equal(map.maxConcurrency, 2)
    assert.ok(map.completionConfig?.includes('toleratedFailures:1'))

    const invoke = graph.nodes.find((n) => n.kind === 'invoke')
    assert.ok(invoke)
    assert.equal(invoke.tenantId, 'tenant-abc-123')
    assert.equal(invoke.target, 'fulfillment-service')

    const child = graph.nodes.find((n) => n.kind === 'runInChildContext')
    assert.ok(child)
    assert.equal(child.nestingType, 'FLAT')

    const step = graph.nodes.find((n) => n.label === 'charge-payment')
    assert.ok(step)
    assert.equal(step.stepSemantics, 'AtMostOncePerRetry')
    assert.equal(step.retryStrategy, 'retry_strategy')
  })
})
