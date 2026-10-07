import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { parseFile } from '../parser.js'
import { renderMermaid } from './mermaid.js'
import { buildEdges, loopLabel, type WorkflowGraph, type WorkflowNode } from '../graph.js'

const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')

describe('renderMermaid', () => {
  it('produces valid Mermaid syntax for TypeScript', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    assert.ok(output.startsWith('graph TD'))
    assert.ok(output.includes('node_start'))
    assert.ok(output.includes('node_end'))
    assert.ok(output.includes('-->'))
  })

  it('supports LR direction', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph, { direction: 'LR' })

    assert.ok(output.startsWith('graph LR'))
  })

  it('includes style directives for all nodes', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    const styleLines = output.split('\n').filter((l) => l.trimStart().startsWith('style '))
    const nodeCount = graph.nodes.length
    // Branch nodes also get styles
    const branchNodeCount = graph.nodes
      .filter((n) => n.branches)
      .reduce((sum, n) => sum + (n.branches?.reduce((s, b) => s + b.nodes.length, 0) ?? 0), 0)

    assert.ok(styleLines.length >= nodeCount + branchNodeCount - 2, // start/end might not get styled in some cases
      `Expected at least ${nodeCount + branchNodeCount - 2} style lines, got ${styleLines.length}`)
  })

  it('includes click callbacks for nodes with source lines', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    const clickLines = output.split('\n').filter((l) => l.includes('call onNodeClick'))
    assert.ok(clickLines.length >= 4, `Expected at least 4 click callbacks, got ${clickLines.length}`)
  })

  it('wraps parallel branches in subgraph', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('subgraph'), 'Should contain a subgraph for parallel branches')
    assert.ok(output.includes('end'), 'Should close the subgraph')
    assert.ok(output.includes('stroke-dasharray'), 'Subgraph should have dashed border')
  })

  it('uses nbsp padding in edge labels', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('&nbsp;'), 'Edge labels should have nbsp padding')
  })

  it('does not use reserved node IDs', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))

    const nodeIds = graph.nodes.map((n) => n.id)
    assert.ok(!nodeIds.includes('start'), 'Should not use reserved ID "start"')
    assert.ok(!nodeIds.includes('end'), 'Should not use reserved ID "end"')
  })

  it('includes config annotations in labels for TypeScript', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow-config.ts'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('flat'), 'Should show FLAT nesting annotation')
    assert.ok(output.includes('first successful'), 'Should show completion config annotation')
    assert.ok(output.includes('AtMostOncePerRetry'), 'Should show step semantics annotation')
    assert.ok(output.includes('tenant tenant-abc-123'), 'Should show tenant ID annotation')
  })

  it('includes config annotations in labels for Python', () => {
    const graph = parseFile(resolve(examplesDir, 'order_processor_with_retry.py'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('flat'), 'Should show FLAT nesting annotation for Python')
    assert.ok(output.includes('tenant tenant-abc-123'), 'Should show tenant ID for Python')
  })

  it('includes config annotations in labels for Java', () => {
    const graph = parseFile(resolve(examplesDir, 'OrderProcessorFutures.java'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('flat'), 'Should show FLAT nesting annotation for Java')
    assert.ok(output.includes('tenant tenant-abc-123'), 'Should show tenant ID for Java')
    assert.ok(output.includes('allOf') || output.includes('anyOf'), 'Should include promise combinator')
  })

  it('includes Rust primitives and max_concurrency annotation', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow.rs'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('validate-order'), 'Should include the Rust step label')
    assert.ok(output.includes('prepare-order'), 'Should include the Rust parallel label')
    assert.ok(output.includes('concurrency 2'), 'Should show max_concurrency annotation')
    assert.ok(output.includes('manager-approval'), 'Should include the callback label')
  })

  it('renders Go primitives, subgraphs, and config annotations', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow_config.go'))
    const output = renderMermaid(graph)

    assert.ok(output.includes('charge-payment'), 'Should include the Go step label')
    assert.ok(output.includes('reserve-inventory'), 'Should include the Go map label')
    assert.ok(output.includes('subgraph'), 'Should wrap map branches in a subgraph')
    assert.ok(output.includes('AtMostOncePerRetry'), 'Should show step semantics annotation')
    assert.ok(output.includes('tenant tenant-001'), 'Should show tenant ID annotation')
    assert.ok(output.includes('flat'), 'Should show FLAT nesting annotation')
    assert.ok(output.includes('concurrency 4'), 'Should show maxConcurrency annotation')
  })
})

describe('renderMermaid loops', () => {
  function loopGraph(nodes: WorkflowNode[]): WorkflowGraph {
    const allNodes: WorkflowNode[] = [
      { id: 'node_start', kind: 'start', label: 'Start' },
      ...nodes,
      { id: 'node_end', kind: 'end', label: 'End' },
    ]
    return { name: 'loops', nodes: allNodes, edges: buildEdges(allNodes) }
  }

  const loop = (id: string, header: string, bodyCount: number, iterations?: number): WorkflowNode => ({
    id,
    kind: 'loop',
    label: loopLabel(header, iterations),
    loopHeader: header,
    bodyCount,
    iterations,
  })

  it('should render the loop header, a body subgraph and a dashed back-edge', () => {
    const output = renderMermaid(loopGraph([
      loop('loop_1', 'const order of orders', 2),
      { id: 'step_2', kind: 'step', label: 'validate' },
      { id: 'step_3', kind: 'step', label: 'charge' },
      { id: 'step_4', kind: 'step', label: 'notify' },
    ]))

    assert.ok(output.includes('loop_1("loop: const order of<br>orders")'))
    assert.ok(output.includes('subgraph sub_loop_1'))
    assert.ok(output.includes('step_3 -.->|&nbsp;&nbsp;next&nbsp;&nbsp;| loop_1'))
    assert.ok(output.includes('loop_1 -->|&nbsp;&nbsp;done&nbsp;&nbsp;| step_4'))
    assert.ok(output.includes('style loop_1 fill:'))
  })

  it('should close the subgraph after the last body node', () => {
    const output = renderMermaid(loopGraph([
      loop('loop_1', 'x', 1),
      { id: 'step_2', kind: 'step', label: 'inside' },
      { id: 'step_3', kind: 'step', label: 'outside' },
    ]))
    const lines = output.split('\n')
    const subgraphIndex = lines.findIndex((line) => line.includes('subgraph sub_loop_1'))
    const insideIndex = lines.findIndex((line) => line.includes('step_2['))
    const endIndex = lines.findIndex((line, i) => i > subgraphIndex && line.trim() === 'end')
    const outsideIndex = lines.findIndex((line) => line.includes('step_3['))

    assert.ok(subgraphIndex < insideIndex && insideIndex < endIndex && endIndex < outsideIndex)
  })

  it('should nest subgraphs for nested loops', () => {
    const output = renderMermaid(loopGraph([
      loop('outer', 'a', 3),
      { id: 'step_a', kind: 'step', label: 'a' },
      loop('inner', 'b', 1),
      { id: 'step_b', kind: 'step', label: 'b' },
    ]))
    const lines = output.split('\n').map((line) => line.trim())

    assert.equal(lines.filter((line) => line.startsWith('subgraph ')).length, 2)
    assert.equal(lines.filter((line) => line === 'end').length, 2)
    assert.ok(lines.indexOf('subgraph sub_outer[" "]') < lines.indexOf('subgraph sub_inner[" "]'))
  })

  it('should keep a parallel node inside a loop body with its own subgraph', () => {
    const output = renderMermaid(loopGraph([
      loop('loop_1', 'x', 1),
      {
        id: 'par_2',
        kind: 'parallel',
        label: 'fan out',
        branches: [{ name: 'a', dynamic: false, nodes: [{ id: 'invoke_3', kind: 'invoke', label: 'a' }] }],
      },
    ]))

    assert.ok(output.includes('subgraph sub_loop_1'))
    assert.ok(output.includes('subgraph sub_par_2'))
    assert.ok(output.includes('invoke_3 -.->|&nbsp;&nbsp;next&nbsp;&nbsp;| loop_1'))
  })

  it('should keep comparison operators readable in loop headers', () => {
    const output = renderMermaid(loopGraph([
      loop('loop_1', 'attempt < 3', 1, 3),
      { id: 'step_2', kind: 'step', label: 'try' },
    ]))

    assert.ok(output.includes('loop: attempt #lt; 3 x3"'))
  })

  it('should break long loop headers into short lines', () => {
    const output = renderMermaid(loopGraph([
      loop('loop_1', 'attempt := 0; attempt < 3; attempt++', 1, 3),
      { id: 'step_2', kind: 'step', label: 'try' },
    ]))

    assert.ok(output.includes('loop_1("loop: attempt := 0;<br>attempt #lt; 3;<br>attempt++ x3")'))
  })

  it('should keep comparison operators readable in condition labels', () => {
    const cond: WorkflowNode = { id: 'cond_1', kind: 'condition', label: 'order.Total > 10000', condition: 'order.Total > 10000', thenCount: 1 }
    const output = renderMermaid(loopGraph([cond, { id: 'step_2', kind: 'step', label: 'approve' }]))

    assert.ok(output.includes('cond_1{"order.Total #gt; 10000"}'))
  })

  it('should keep parentheses, brackets, braces and pipes in loop and condition labels', () => {
    const cond: WorkflowNode = {
      id: 'cond_1',
      kind: 'condition',
      label: 'items[0] || cfg.get({a: 1})',
      condition: 'items[0] || cfg.get({a: 1})',
      thenCount: 1,
    }
    const output = renderMermaid(loopGraph([
      loop('loop_1', 'var x in GetItems(id)', 1),
      cond,
      { id: 'step_2', kind: 'step', label: 'work' },
    ]))

    assert.ok(output.includes('loop_1("loop: var x in<br>GetItems(id)")'))
    assert.ok(output.includes('cond_1{"items[0] || cfg.get({a: 1})"}'))
  })

  it('should escape quotes and hash signs inside quoted labels', () => {
    const cond: WorkflowNode = { id: 'cond_1', kind: 'condition', label: 'tag == "#vip"', condition: 'tag == "#vip"', thenCount: 1 }
    const output = renderMermaid(loopGraph([cond, { id: 'step_2', kind: 'step', label: 'work' }]))

    assert.ok(output.includes('cond_1{"tag == #quot;#35;vip#quot;"}'))
  })
})
