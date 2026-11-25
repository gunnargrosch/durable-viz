/**
 * Render a WorkflowGraph as a Mermaid flowchart.
 */

import { buildEdges, type WorkflowGraph, type WorkflowNode, type WorkflowEdge } from '../graph.js'
import { cardGroupForKind, cardIconForKind, cardKindLabel } from './card-theme.js'

export interface MermaidOptions {
  direction?: 'TD' | 'LR'
  /**
   * "classic" uses colored Mermaid shapes and renders anywhere Mermaid does.
   * "card" emits HTML labels and class names meant for a page that loads the
   * card theme CSS (see card-theme.ts). Defaults to "classic".
   */
  style?: 'classic' | 'card'
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
  if (node.subType) parts.push(`subtype ${node.subType}`)
  if (node.maxConcurrency != null) parts.push(`concurrency ${node.maxConcurrency}`)
  if (parts.length === 0) return ''
  return '<br>' + parts.join('<br>')
}

function buildCardMeta(node: WorkflowNode): string {
  const parts = buildAnnotation(node).split('<br>').filter((part) =>
    part && !(node.kind === 'microvm' && part.startsWith('subtype '))
  )
  return parts.length ? `<span class='dv-meta'>${parts.join(' · ')}</span>` : ''
}

/** Card-style node: terminals are circles, everything else is a rectangle with an icon and two text lines. */
function cardShape(node: WorkflowNode): string {
  if (node.kind === 'start' || node.kind === 'end') {
    return `(("<span class='dv-terminal-label'>${escQuoted(node.label)}</span>"))`
  }
  const icon = cardIconForKind(node.kind)
  const iconHtml = icon ? `<span class='dv-icon dv-i-${icon}'></span>` : ''
  const name = escQuoted(node.label)
  const kindLabel = cardKindLabel(node)
  return `["<div class='dv-card'>${iconHtml}<span class='dv-text'><span class='dv-kind'>${kindLabel}</span><span class='dv-name'>${name}</span>${buildCardMeta(node)}</span></div>"]`
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
    case 'microvm':
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

/** Leaf nodes inside a container body, used as exits to the next workflow node. */
function exitIds(node: WorkflowNode): string[] {
  if (!node.children?.length) return [node.id]
  const childEdges = buildEdges(node.children)
  const sources = new Set(childEdges.map((edge) => edge.from))
  const leaves = node.children.filter((child) => !sources.has(child.id))
  if (leaves.length === 0) return [node.id]
  return leaves.flatMap((leaf) => exitIds(leaf))
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
    case 'microvm':
      return `style ${node.id} fill:#9b573c,stroke:#7d4630,color:#f7e7df`
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
  const card = options?.style === 'card'
  const shape = card ? cardShape : shapeForKind
  const lines: string[] = [`graph ${direction}`]
  if (graph.otel) {
    const mode = graph.otel.environmentVariable
      ? `selected by ${graph.otel.environmentVariable}${graph.otel.modes?.length ? ` (${graph.otel.modes.join(' or ')})` : ''}`
      : graph.otel.mode === 'custom'
        ? `custom registration${graph.otel.registration ? ` (${graph.otel.registration})` : ''}`
        : `${graph.otel.mode} mode`
    lines.push(`  %% OTel plugin: ${mode}, Workflow span "${graph.otel.workflowSpanName}"`)
  }

  // Collect all nodes for styling and click callbacks
  const allNodes: WorkflowNode[] = []
  const topLevelExits = new Map<string, string[]>()
  for (const node of graph.nodes) topLevelExits.set(node.id, exitIds(node))

  const subgraphStyle = (subId: string) => card ? '' :
    `  style ${subId} fill:transparent,stroke:#444,stroke-width:1px,stroke-dasharray:5 5,rx:8,ry:8`

  // Loop bodies are the flat nodes that follow a loop node. Track where each
  // open loop subgraph ends so nested loops close in the right order.
  const openLoops: { subId: string; endIndex: number }[] = []

  // Emit node definitions, using subgraphs for parallel/map branches and loop bodies
  graph.nodes.forEach((node, index) => {
    allNodes.push(node)

    const hasBranches = (node.kind === 'parallel' || node.kind === 'map') && node.branches?.length
    const hasChildren = node.children?.length

    if (hasBranches) {
      // Emit the parallel/map hub node outside the subgraph
      lines.push(`  ${node.id}${shape(node)}`)

      // Emit branch nodes inside a subgraph
      const subId = `sub_${node.id}`
      lines.push(`  subgraph ${subId}[" "]`)

      for (const branch of node.branches!) {
        for (const bNode of branch.nodes) {
          allNodes.push(bNode)
          lines.push(`    ${bNode.id}${shape(bNode)}`)
        }
      }

      lines.push('  end')
      // Style the subgraph container
      if (!card) lines.push(subgraphStyle(subId))
    } else if (hasChildren) {
      const subId = `sub_${node.id}`
      lines.push(`  subgraph ${subId}[" "]`)
      lines.push(`    ${node.id}${shape(node)}`)
      lines.push(`    ${node.id} -.-> ${node.children![0].id}`)
      for (const child of node.children!) {
        allNodes.push(child)
        lines.push(`    ${child.id}${shape(child)}`)
      }
      const childExits = new Map<string, string[]>()
      for (const child of node.children!) childExits.set(child.id, exitIds(child))
      for (const edge of buildEdges(node.children!)) {
        for (const from of childExits.get(edge.from) ?? [edge.from]) {
          lines.push(`  ${renderEdge({ ...edge, from })}`)
        }
      }
      lines.push('  end')
      if (!card) lines.push(subgraphStyle(subId))
    } else if (node.kind === 'loop') {
      // The loop header sits outside the subgraph, like a parallel hub
      lines.push(`  ${node.id}${shape(node)}`)
      const bodyEnd = Math.min(index + Math.max(node.bodyCount ?? 1, 1), graph.nodes.length - 1)
      const subId = `sub_${node.id}`
      lines.push(`  subgraph ${subId}[" "]`)
      openLoops.push({ subId, endIndex: bodyEnd })
    } else {
      lines.push(`  ${node.id}${shape(node)}`)
    }

    // Close every loop subgraph whose body ends at this node
    while (openLoops.length > 0 && openLoops[openLoops.length - 1].endIndex <= index) {
      const closed = openLoops.pop()!
      lines.push('  end')
      if (!card) lines.push(subgraphStyle(closed.subId))
    }
  })

  lines.push('')

  // Edges. A container body exits to the next workflow node from its last
  // nested operation, not from the container node itself.
  for (const edge of graph.edges) {
    for (const from of topLevelExits.get(edge.from) ?? [edge.from]) {
      lines.push(renderEdge({ ...edge, from }))
    }
  }

  lines.push('')

  // Styles
  for (const node of allNodes) {
    if (card) {
      lines.push(`  class ${node.id} dv-${cardGroupForKind(node.kind)}`)
      continue
    }
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
