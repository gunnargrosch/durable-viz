import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { parseFile } from './parser.js'
import { renderMermaid } from './renderers/mermaid.js'

const examplesDir = resolve(import.meta.dirname, '../../..', 'examples')

const loopExamples = [
  'order-batch-loop.ts',
  'order_batch_loop.py',
  'OrderBatchLoop.java',
  'OrderBatchLoop.cs',
  'order_batch_loop.rs',
  'order_batch_loop.go',
]

describe('loop examples', () => {
  for (const fileName of loopExamples) {
    describe(fileName, () => {
      const graph = parseFile(resolve(examplesDir, fileName))
      const loops = graph.nodes.filter((n) => n.kind === 'loop')

      it('should find a for-each loop and a counted loop', () => {
        assert.equal(loops.length, 2)
        assert.equal(loops[1].iterations, 3)
      })

      it('should put the approval condition and the charge step inside the first loop', () => {
        const index = graph.nodes.indexOf(loops[0])
        const body = graph.nodes.slice(index + 1, index + 1 + (loops[0].bodyCount ?? 0))
        const labels = body.map((n) => n.label)

        assert.equal(labels[0], 'validate-order')
        assert.ok(body.some((n) => n.kind === 'condition'))
        assert.ok(body.some((n) => n.kind === 'waitForCallback'))
        assert.equal(labels[labels.length - 1], 'charge-order')
      })

      it('should end with the summary step after both loops', () => {
        const steps = graph.nodes.filter((n) => n.kind === 'step')
        assert.equal(steps[steps.length - 1].label, 'send-summary')
      })

      it('should render both loops with subgraphs and dashed back-edges', () => {
        const output = renderMermaid(graph)

        assert.equal(output.split('\n').filter((line) => line.trim().startsWith('subgraph')).length, 2)
        assert.equal(output.split('\n').filter((line) => line.includes('-.->')).length, 2)
      })
    })
  }
})
