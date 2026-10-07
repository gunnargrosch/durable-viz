import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildEdges, loopLabel, type NodeKind, type WorkflowEdge, type WorkflowNode } from './graph.js'

function makeNode(id: string, kind: NodeKind = 'step', extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, kind, label: id, ...extra }
}

function loopNode(id: string, bodyCount: number): WorkflowNode {
  return makeNode(id, 'loop', { bodyCount, loopHeader: 'item of items' })
}

/** Render edges as "from>to[:label][~back]" strings for compact assertions. */
function describeEdges(edges: WorkflowEdge[]): string[] {
  return edges.map((edge) => `${edge.from}>${edge.to}${edge.label ? `:${edge.label}` : ''}${edge.style === 'back' ? '~back' : ''}`)
}

const start = makeNode('start', 'start')
const end = makeNode('end', 'end')

describe('loopLabel', () => {
  it('should prefix the header with loop:', () => {
    assert.equal(loopLabel('const order of orders'), 'loop: const order of orders')
  })

  it('should append the iteration count when known', () => {
    assert.equal(loopLabel('i < 3', 3), 'loop: i < 3 x3')
  })

  it('should fall back to a bare label for an empty header', () => {
    assert.equal(loopLabel('  '), 'loop')
  })
})

describe('buildEdges with loops', () => {
  it('should add a back-edge from the last body node and a done edge to the next node', () => {
    const nodes = [start, loopNode('loop', 2), makeNode('a'), makeNode('b'), makeNode('after'), end]
    assert.deepEqual(describeEdges(buildEdges(nodes)), [
      'start>loop',
      'loop>a',
      'loop>after:done',
      'a>b',
      'b>loop:next~back',
      'after>end',
    ])
  })

  it('should exit to End when the loop is the last thing in the workflow', () => {
    const nodes = [start, loopNode('loop', 1), makeNode('a'), end]
    assert.deepEqual(describeEdges(buildEdges(nodes)), [
      'start>loop',
      'loop>a',
      'loop>end:done',
      'a>loop:next~back',
    ])
  })

  it('should keep yes/no edges for a condition in the middle of a loop body', () => {
    const cond = makeNode('cond', 'condition', { thenCount: 1 })
    const nodes = [start, loopNode('loop', 3), cond, makeNode('t'), makeNode('tail'), end]
    assert.deepEqual(describeEdges(buildEdges(nodes)), [
      'start>loop',
      'loop>cond',
      'loop>end:done',
      'cond>t:yes',
      'cond>tail:no',
      't>tail',
      'tail>loop:next~back',
    ])
  })

  it('should send both the no edge and the then-branch to the loop header when the condition ends the body', () => {
    const cond = makeNode('cond', 'condition', { thenCount: 1 })
    const nodes = [start, loopNode('loop', 3), makeNode('a'), cond, makeNode('t'), makeNode('after'), end]
    assert.deepEqual(describeEdges(buildEdges(nodes)), [
      'start>loop',
      'loop>a',
      'loop>after:done',
      'a>cond',
      'cond>t:yes',
      'cond>loop:no~back',
      't>loop:next~back',
      'after>end',
    ])
  })

  it('should connect a returning then-branch to End instead of the loop header', () => {
    const cond = makeNode('cond', 'condition', { thenCount: 1, thenReturns: true })
    const nodes = [start, loopNode('loop', 3), makeNode('a'), cond, makeNode('t'), end]
    const edges = describeEdges(buildEdges(nodes))
    assert.ok(edges.includes('t>end'))
    assert.ok(!edges.includes('t>loop:next~back'))
    assert.ok(edges.includes('cond>loop:no~back'))
  })

  it('should send the done edge of an inner loop to the outer loop header when both end together', () => {
    const nodes = [start, loopNode('outer', 3), makeNode('a'), loopNode('inner', 1), makeNode('b'), makeNode('after'), end]
    assert.deepEqual(describeEdges(buildEdges(nodes)), [
      'start>outer',
      'outer>a',
      'outer>after:done',
      'a>inner',
      'inner>b',
      'inner>outer:done~back',
      'b>inner:next~back',
      'after>end',
    ])
  })

  it('should exit an inner loop to the next body node of the outer loop when it does not end the outer body', () => {
    const nodes = [start, loopNode('outer', 3), loopNode('inner', 1), makeNode('b'), makeNode('c'), end]
    const edges = describeEdges(buildEdges(nodes))
    assert.ok(edges.includes('inner>c:done'))
    assert.ok(edges.includes('b>inner:next~back'))
    assert.ok(edges.includes('c>outer:next~back'))
  })

  it('should fan a trailing parallel node in to the loop header', () => {
    const parallel = makeNode('par', 'parallel', {
      branches: [{ name: 'x', dynamic: false, nodes: [makeNode('x1')] }],
    })
    const nodes = [start, loopNode('loop', 1), parallel, makeNode('after'), end]
    const edges = describeEdges(buildEdges(nodes))
    assert.ok(edges.includes('par>x1:x'))
    assert.ok(edges.includes('x1>loop:next~back'))
    assert.ok(edges.includes('loop>after:done'))
  })

  it('should leave graphs without loops unchanged', () => {
    const nodes = [start, makeNode('a'), makeNode('b'), end]
    assert.deepEqual(describeEdges(buildEdges(nodes)), ['start>a', 'a>b', 'b>end'])
  })
})
