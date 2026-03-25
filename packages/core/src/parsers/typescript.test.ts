import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { TypeScriptParser } from './typescript.js'

const parser = new TypeScriptParser()
const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')

describe('TypeScriptParser', () => {
  it('parses the order workflow example', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'))

    assert.equal(graph.name, 'order-workflow')

    const kinds = graph.nodes.map((n) => n.kind)
    assert.ok(kinds.includes('start'))
    assert.ok(kinds.includes('end'))
    assert.ok(kinds.includes('step'))
    assert.ok(kinds.includes('parallel'))
    assert.ok(kinds.includes('waitForCallback'))
    assert.ok(kinds.includes('condition'))
  })

  it('extracts step names', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'))

    const stepLabels = graph.nodes
      .filter((n) => n.kind === 'step')
      .map((n) => n.label)

    assert.ok(stepLabels.includes('validate-order'))
    assert.ok(stepLabels.includes('review-results'))
    assert.ok(stepLabels.includes('fulfill-order'))
  })

  it('extracts parallel branches with invoke targets', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'))

    const parallel = graph.nodes.find((n) => n.kind === 'parallel')
    assert.ok(parallel)
    assert.equal(parallel.label, 'prepare-order')
    assert.ok(parallel.branches)
    assert.equal(parallel.branches.length, 2)

    const branchNames = parallel.branches.map((b) => b.name)
    assert.ok(branchNames.includes('check-inventory'))
    assert.ok(branchNames.includes('reserve-payment'))
  })

  it('detects condition with waitForCallback', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'))

    const condition = graph.nodes.find((n) => n.kind === 'condition')
    assert.ok(condition)
    assert.ok(condition.thenCount)
    assert.ok(condition.thenCount >= 1)

    const callback = graph.nodes.find((n) => n.kind === 'waitForCallback')
    assert.ok(callback)
    assert.equal(callback.label, 'manager-approval')
  })

  it('includes source line numbers', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'))

    const nodesWithLines = graph.nodes.filter((n) => n.sourceLine != null)
    assert.ok(nodesWithLines.length >= 5, `Expected at least 5 nodes with source lines, got ${nodesWithLines.length}`)

    for (const node of nodesWithLines) {
      assert.ok(node.sourceLine! > 0, `Source line should be positive, got ${node.sourceLine}`)
    }
  })

  it('generates edges connecting all nodes', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'))

    assert.ok(graph.edges.length > 0)

    // Start should have an outgoing edge
    const startEdges = graph.edges.filter((e) => e.from === 'node_start')
    assert.equal(startEdges.length, 1)

    // End should have incoming edges
    const endEdges = graph.edges.filter((e) => e.to === 'node_end')
    assert.ok(endEdges.length >= 1)
  })

  it('condition yes/no edges exist', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'))

    const yesEdge = graph.edges.find((e) => e.label === 'yes')
    const noEdge = graph.edges.find((e) => e.label === 'no')
    assert.ok(yesEdge, 'Should have a yes edge')
    assert.ok(noEdge, 'Should have a no edge')
  })

  it('allows name override', () => {
    const graph = parser.parseFile(resolve(examplesDir, 'order-workflow.ts'), { name: 'custom-name' })
    assert.equal(graph.name, 'custom-name')
  })

  it('throws for non-durable files', () => {
    // The examples directory has a Python file with no withDurableExecution
    assert.throws(
      () => parser.parseFile(resolve(examplesDir, 'order_processor.py')),
      /No withDurableExecution/
    )
  })
})
