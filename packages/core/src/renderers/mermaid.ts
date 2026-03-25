/**
 * Render a WorkflowGraph as a Mermaid flowchart.
 */

import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from '../graph.js'

export interface MermaidOptions {
  direction?: 'TD' | 'LR'
}

/** Escape text for use inside Mermaid node labels. */
function esc(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()<>]/g, ' ')
}

function shapeForKind(node: WorkflowNode): string {
  const label = esc(node.label)
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
      return `[[${label}]]`
    case 'condition':
      return `{${label}}`
    default:
      return `[${label}]`
  }
}

/** Escape text for use in edge labels — no parens, brackets, or pipes. */
function escEdge(text: string): string {
  return text.replace(/[[\]{}()<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderEdge(edge: WorkflowEdge): string {
  if (edge.label) {
    const label = `#nbsp;#nbsp;${escEdge(edge.label)}#nbsp;#nbsp;`
    return `  ${edge.from} -->|${label}| ${edge.to}`
  }
  return `  ${edge.from} --> ${edge.to}`
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
      return `style ${node.id} fill:#4a849e,stroke:#3d6d83,color:#deedf3`
    case 'condition':
      return `style ${node.id} fill:#6b71a8,stroke:#575c8a,color:#e3e4f0`
    default:
      return undefined
  }
}

export function renderMermaid(graph: WorkflowGraph, options?: MermaidOptions): string {
  const direction = options?.direction ?? 'TD'
  const lines: string[] = [`graph ${direction}`]

  // Collect all nodes for styling and click callbacks
  const allNodes: WorkflowNode[] = []

  // Emit node definitions, using subgraphs for parallel/map branches
  for (const node of graph.nodes) {
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
      lines.push(`  style ${subId} fill:transparent,stroke:#444,stroke-width:1px,stroke-dasharray:5 5,rx:8,ry:8`)
    } else {
      lines.push(`  ${node.id}${shapeForKind(node)}`)
    }
  }

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
