/**
 * Render a WorkflowGraph as a Mermaid flowchart.
 */

import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from '../graph.js'

export interface MermaidOptions {
  direction?: 'TD' | 'LR'
}

/** Escape text for use inside Mermaid node labels. */
function esc(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()<>|]/g, ' ')
}

/**
 * Escape text for a quoted Mermaid label. Inside quotes, parentheses, brackets,
 * braces and pipes are safe, so code like `items.iter()` keeps them. Characters
 * that Mermaid would read as markup or an entity are written as entity codes.
 */
function escQuoted(text: string): string {
  return text
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
}

/** Break long labels at spaces so node width does not depend on the renderer's own wrapping. */
function wrapLabel(text: string, maxLineLength = 24): string {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    if (current && (current + ' ' + word).length > maxLineLength) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines.join('<br>')
}

function buildAnnotation(node: WorkflowNode): string {
  const parts: string[] = []
  if (node.nestingType === 'FLAT') parts.push('flat')
  if (node.completionConfig) parts.push(node.completionConfig)
  if (node.stepSemantics) parts.push(node.stepSemantics)
  if (node.tenantId) parts.push(`tenant ${node.tenantId}`)
  if (node.maxConcurrency != null) parts.push(`concurrency ${node.maxConcurrency}`)
  if (parts.length === 0) return ''
  return '<br>' + parts.join('<br>')
}

function shapeForKind(node: WorkflowNode): string {
  const quoted = node.kind === 'loop' || node.kind === 'condition'
  const text = node.kind === 'loop'
    ? wrapLabel(escQuoted(node.label))
    : node.kind === 'condition'
      ? escQuoted(node.label)
      : esc(node.label)
  const label = (quoted ? `"${text}${buildAnnotation(node)}"` : text + buildAnnotation(node))
  switch (node.kind) {
    case 'start':
    case 'end':
      return `([${label}])`
    case 'step':
      return `[${label}]`
    case 'invoke':
      return `[/${label}\\]`
    case 'parallel':
    case 'map':
    case 'promiseAll':
    case 'promiseAny':
    case 'promiseRace':
    case 'promiseAllSettled':
      return `{{${label}}}`
    case 'wait':
    case 'waitForCallback':
    case 'createCallback':
    case 'waitForCondition':
      return `((${label}))`
    case 'runInChildContext':
    case 'withRetry':
      return `[[${label}]]`
    case 'condition':
      return `{${label}}`
    case 'loop':
      return `(${label})`
    default:
      return `[${label}]`
  }
}

/** Escape text for use in edge labels — no parens, brackets, or pipes. */
function escEdge(text: string): string {
  return text.replace(/[[\]{}()<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderEdge(edge: WorkflowEdge): string {
  // Back-edges to a loop header are dashed so they read as "repeat"
  const arrow = edge.style === 'back' ? '-.->' : '-->'
  if (edge.label) {
    const label = `&nbsp;&nbsp;${escEdge(edge.label)}&nbsp;&nbsp;`
    return `  ${edge.from} ${arrow}|${label}| ${edge.to}`
  }
  return `  ${edge.from} ${arrow} ${edge.to}`
}

function styleForKind(node: WorkflowNode): string | undefined {
  switch (node.kind) {
    case 'start':
    case 'end':
      return `style ${node.id} fill:#5b8ab4,stroke:#4a7293,color:#e8edf2`
    case 'step':
      return `style ${node.id} fill:#4a8c72,stroke:#3d7360,color:#e0efe8`
    case 'invoke':
      return `style ${node.id} fill:#b8873a,stroke:#967032,color:#f5edd8`
    case 'parallel':
    case 'map':
    case 'promiseAll':
    case 'promiseAny':
    case 'promiseRace':
    case 'promiseAllSettled':
      return `style ${node.id} fill:#7b6b9e,stroke:#655883,color:#e8e3f0`
    case 'wait':
    case 'waitForCallback':
    case 'createCallback':
    case 'waitForCondition':
      return `style ${node.id} fill:#b05a5a,stroke:#8f4a4a,color:#f2e0e0`
    case 'runInChildContext':
    case 'withRetry':
      return `style ${node.id} fill:#4a849e,stroke:#3d6d83,color:#deedf3`
    case 'condition':
      return `style ${node.id} fill:#6b71a8,stroke:#575c8a,color:#e3e4f0`
    case 'loop':
      return `style ${node.id} fill:#7d8a3e,stroke:#657131,color:#eef0dc`
    default:
      return undefined
  }
}

export function renderMermaid(graph: WorkflowGraph, options?: MermaidOptions): string {
  const direction = options?.direction ?? 'TD'
  const lines: string[] = [`graph ${direction}`]

  // Collect all nodes for styling and click callbacks
  const allNodes: WorkflowNode[] = []

  const subgraphStyle = (subId: string) =>
    `  style ${subId} fill:transparent,stroke:#444,stroke-width:1px,stroke-dasharray:5 5,rx:8,ry:8`

  // Loop bodies are the flat nodes that follow a loop node. Track where each
  // open loop subgraph ends so nested loops close in the right order.
  const openLoops: { subId: string; endIndex: number }[] = []

  // Emit node definitions, using subgraphs for parallel/map branches and loop bodies
  graph.nodes.forEach((node, index) => {
    allNodes.push(node)

    const hasBranches = (node.kind === 'parallel' || node.kind === 'map') && node.branches?.length

    if (hasBranches) {
      // Emit the parallel/map hub node outside the subgraph
      lines.push(`  ${node.id}${shapeForKind(node)}`)

      // Emit branch nodes inside a subgraph
      const subId = `sub_${node.id}`
      lines.push(`  subgraph ${subId}[" "]`)

      for (const branch of node.branches!) {
        for (const bNode of branch.nodes) {
          allNodes.push(bNode)
          lines.push(`    ${bNode.id}${shapeForKind(bNode)}`)
        }
      }

      lines.push('  end')
      // Style the subgraph container
      lines.push(subgraphStyle(subId))
    } else if (node.kind === 'loop') {
      // The loop header sits outside the subgraph, like a parallel hub
      lines.push(`  ${node.id}${shapeForKind(node)}`)
      const bodyEnd = Math.min(index + Math.max(node.bodyCount ?? 1, 1), graph.nodes.length - 1)
      const subId = `sub_${node.id}`
      lines.push(`  subgraph ${subId}[" "]`)
      openLoops.push({ subId, endIndex: bodyEnd })
    } else {
      lines.push(`  ${node.id}${shapeForKind(node)}`)
    }

    // Close every loop subgraph whose body ends at this node
    while (openLoops.length > 0 && openLoops[openLoops.length - 1].endIndex <= index) {
      const closed = openLoops.pop()!
      lines.push('  end')
      lines.push(subgraphStyle(closed.subId))
    }
  })

  lines.push('')

  // Edges
  for (const edge of graph.edges) {
    lines.push(renderEdge(edge))
  }

  lines.push('')

  // Styles
  for (const node of allNodes) {
    const style = styleForKind(node)
    if (style) lines.push(`  ${style}`)
  }

  // Click callbacks for nodes with source lines
  for (const node of allNodes) {
    if (node.sourceLine != null) {
      lines.push(`  click ${node.id} call onNodeClick(${node.sourceLine})`)
    }
  }

  return lines.join('\n')
}
