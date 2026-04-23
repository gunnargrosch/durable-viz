import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { JavaParser } from './java.js'

const parser = new JavaParser()
const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')

describe('JavaParser', () => {
  it('parses the OrderProcessor example', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.java'))

    assert.equal(graph.name, 'OrderProcessor')

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('start'))
    assert.ok(kinds.includes('end'))
    assert.ok(kinds.includes('step'))
    assert.ok(kinds.includes('parallel'))
    assert.ok(kinds.includes('wait'))
    assert.ok(kinds.includes('invoke'))
    assert.ok(kinds.includes('waitForCallback'))
    assert.ok(kinds.includes('condition'))
  })

  it('extracts step names from string literals', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.java'))

    const stepLabels = graph.nodes
      .filter((n) => n.kind === 'step')
      .map((n) => n.label)

    assert.ok(stepLabels.includes('validate-order'))
    assert.ok(stepLabels.includes('send-confirmation'))
  })

  it('extracts invoke target', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.java'))

    const invoke = graph.nodes.find((n) => n.kind === 'invoke')
    assert.ok(invoke)
    assert.equal(invoke.target, 'fulfillment-service')
  })

  it('extracts parallel branches', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.java'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel)
    assert.equal(parallel.label, 'prepare')
    assert.ok(parallel.branches)
    assert.equal(parallel.branches.length, 2)

    const branchNames = parallel.branches.map((b) => b.name)
    assert.ok(branchNames.includes('reserve-inventory'))
    assert.ok(branchNames.includes('process-payment'))
  })

  it('detects condition with waitForCallback', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.java'))

    const condition = graph.nodes.find((n) => n.kind === 'condition')
    assert.ok(condition)
    assert.ok(condition.thenCount)

    const callback = graph.nodes.find((n) => n.kind === 'waitForCallback')
    assert.ok(callback)
    assert.equal(callback.label, 'manager-approval')
  })

  it('includes source line numbers', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.java'))

    const nodesWithLines = graph.nodes.filter((n) => n.sourceLine != null)
    assert.ok(nodesWithLines.length >= 5, `Expected at least 5 nodes with source lines, got ${nodesWithLines.length}`)
  })

  it('generates valid edges', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'OrderProcessor.java'))

    assert.ok(graph.edges.length > 0)

    const startEdges = graph.edges.filter((e) => e.from === 'node_start')
    assert.equal(startEdges.length, 1)

    const endEdges = graph.edges.filter((e) => e.to === 'node_end')
    assert.ok(endEdges.length >= 1)
  })

  it('throws for non-durable files', () => {
    assert.throws(
      () => parser.parseFile(resolve(examplesDir, 'order_processor.py')),
      /No DurableHandler/
    )
  })
})
