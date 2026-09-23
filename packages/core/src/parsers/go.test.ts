import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { GoParser } from './go.js'
import { parseFile } from '../parser.js'

const parser = new GoParser()
const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')
const fixturesDir = resolve(import.meta.dirname, '../../../..', 'packages/core/test-fixtures')

describe('GoParser', () => {
  it('parses the order_workflow example', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.go'))

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

  it('extracts step names from the call arguments', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.go'))

    const stepLabels = graph.nodes.filter((n) => n.kind === 'step').map((n) => n.label)
    assert.ok(stepLabels.includes('validate-order'))
    assert.equal(stepLabels.length, 1)
  })

  it('extracts parallel branch names', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.go'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel)
    assert.equal(parallel.label, 'prepare-shipment')
    assert.ok(parallel.branches)
    assert.equal(parallel.branches.length, 2)

    const branchNames = parallel.branches.map((b) => b.name)
    assert.ok(branchNames.includes('generate-label'))
    assert.ok(branchNames.includes('generate-tracking'))
  })

  it('extracts the wait name and duration', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.go'))

    const wait = graph.nodes.find((n) => n.kind === 'wait')
    assert.ok(wait)
    assert.equal(wait.label, 'cooling-off')
    assert.equal(wait.timeout, '5*time.Second')
  })

  it('detects the condition wrapping the callback', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.go'))

    const condition = graph.nodes.find((n) => n.kind === 'condition')
    assert.ok(condition)
    assert.equal(condition.condition, 'event.RequireApproval')
    assert.equal(condition.thenCount, 1)
  })

  it('does not treat error-handling if statements as conditions', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow.go'))

    const conditions = graph.nodes.filter((n) => n.kind === 'condition')
    assert.equal(conditions.length, 1)
    assert.equal(conditions[0].condition, 'event.RequireApproval')
  })

  it('parses the order_workflow_config example', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    assert.equal(graph.name, 'order_workflow_config')

    const kinds = graph.nodes.map((n) => n.kind)
    for (const kind of ['step', 'invoke', 'map', 'runInChildContext', 'withRetry', 'waitForCondition', 'promiseAll', 'promiseAny', 'promiseRace', 'promiseAllSettled']) {
      assert.ok((kinds as string[]).includes(kind), `expected kind ${kind}`)
    }
  })

  it('extracts step retry strategy and semantics', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    const step = graph.nodes.find((n) => n.kind === 'step' && n.label === 'charge-payment')
    assert.ok(step)
    assert.equal(step.retryStrategy, 'ExponentialBackoff')
    assert.equal(step.stepSemantics, 'AtMostOncePerRetry')
  })

  it('extracts invoke target and tenant id', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    const invoke = graph.nodes.find((n) => n.kind === 'invoke' && n.label === 'notify-customer')
    assert.ok(invoke)
    assert.equal(invoke.target, 'notify-fn:$LATEST')
    assert.equal(invoke.tenantId, 'tenant-001')
  })

  it('extracts map concurrency, completion config, and inner branch nodes', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    const map = graph.nodes.find((n) => n.kind === 'map')
    assert.ok(map)
    assert.equal(map.label, 'reserve-inventory')
    assert.equal(map.maxConcurrency, 4)
    assert.equal(map.completionConfig, 'minSuccessful:1 toleratedFailures:2')
    assert.ok(map.branches?.length)
    assert.equal(map.branches[0].nodes[0].label, 'reserve-item')
  })

  it('extracts the flat child context', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    const child = graph.nodes.find((n) => n.kind === 'runInChildContext')
    assert.ok(child)
    assert.equal(child.label, 'settlement')
    assert.equal(child.nestingType, 'FLAT')
  })

  it('extracts the withRetry strategy', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    const retry = graph.nodes.find((n) => n.kind === 'withRetry')
    assert.ok(retry)
    assert.equal(retry.label, 'flaky-sync')
    assert.equal(retry.retryStrategy, 'MustLinearBackoff')
  })

  it('maps concurrency combinators to promise kinds', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    const labelFor = (kind: string) => graph.nodes.find((n) => n.kind === kind)?.label
    assert.equal(labelFor('promiseAll'), 'await-all')
    assert.equal(labelFor('promiseAny'), 'await-any')
    assert.equal(labelFor('promiseRace'), 'await-race')
    assert.equal(labelFor('promiseAllSettled'), 'await-settled')
  })

  it('does not duplicate nested durable calls as top-level nodes', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order_workflow_config.go'))

    // The map callback and the child context each contain one inner step; they
    // must belong to the map branch / be skipped, not appear at top level.
    const topLevelStepLabels = graph.nodes.filter((n) => n.kind === 'step').map((n) => n.label)
    assert.ok(!topLevelStepLabels.includes('reserve-item'))
    assert.ok(!topLevelStepLabels.includes('close-ledger'))
  })

  it('follows same-file helper functions that accept a durable Context', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'go_helpers.go'))

    const stepLabels = graph.nodes.filter((n) => n.kind === 'step').map((n) => n.label)
    assert.ok(stepLabels.includes('validate'))
    assert.ok(stepLabels.includes('dynamic-step'))
  })

  it('resolves a local string constant as a step name', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'go_helpers.go'))

    const step = graph.nodes.find((n) => n.kind === 'step' && n.label === 'dynamic-step')
    assert.ok(step)
  })

  it('parses an inline function passed to durable.Wrap', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'go_inline.go'))

    const step = graph.nodes.find((n) => n.kind === 'step')
    assert.ok(step)
    assert.equal(step.label, 'inline-step')
  })

  it('parses CreateCallback, Go, Join, and Select', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'go_misc.go'))

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('createCallback'))
    assert.ok(kinds.includes('runInChildContext'))
    assert.ok(kinds.includes('promiseAll'))
    assert.ok(kinds.includes('promiseRace'))

    const createCb = graph.nodes.find((n) => n.kind === 'createCallback')
    assert.equal(createCb?.label, 'external-callback')
    const go_ = graph.nodes.find((n) => n.kind === 'runInChildContext')
    assert.equal(go_?.label, 'background')
  })

  it('ignores durable-looking text in comments, strings, and runes', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'go_formatting.go'))

    const labels = graph.nodes.map((n) => n.label)
    assert.ok(!labels.includes('commented-out'), 'line comment must be ignored')
    assert.ok(!labels.includes('in-a-block-comment'), 'block comment must be ignored')
    assert.ok(!labels.includes('in-a-string'), 'string literal must be ignored')
  })

  it('handles nested generic type arguments', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'go_formatting.go'))

    const invoke = graph.nodes.find((n) => n.kind === 'invoke')
    assert.ok(invoke)
    assert.equal(invoke.label, 'nested-generics')
    assert.equal(invoke.target, 'target-fn:$LATEST')
  })

  it('keeps a brace inside a condition string literal', () => {
    const graph = parser.parseFile(resolve(fixturesDir, 'go_formatting.go'))

    const condition = graph.nodes.find((n) => n.kind === 'condition')
    assert.ok(condition)
    assert.equal(condition.condition, 'event.Note != "}"')

    const guarded = graph.nodes.find((n) => n.kind === 'step' && n.label === 'guarded')
    assert.ok(guarded, 'the step inside the condition should be detected')
  })

  it('throws when there is no durable entry point', () => {
    assert.throws(() => parser.parseFile(resolve(fixturesDir, 'go_no_entry.go')), /No durable\.Start\(\) entry point/)
  })

  it('is selected by parseFile for .go files', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow.go'))
    assert.equal(graph.name, 'order_workflow')
  })
})
