/**
 * Workflow graph model for durable functions.
 *
 * Represents the structure extracted from AST analysis as a directed graph
 * of nodes (durable primitives) connected by edges.
 */

export type NodeKind =
  | 'start'
  | 'end'
  | 'step'
  | 'invoke'
  | 'parallel'
  | 'map'
  | 'wait'
  | 'waitForCallback'
  | 'createCallback'
  | 'waitForCondition'
  | 'runInChildContext'
  | 'promiseAll'
  | 'promiseAny'
  | 'promiseRace'
  | 'promiseAllSettled'
  | 'condition'

export interface WorkflowNode {
  id: string
  kind: NodeKind
  label: string
  /** For parallel nodes, the child branches. */
  branches?: WorkflowBranch[]
  /** For condition nodes, the expression text (e.g. "requireApproval"). */
  condition?: string
  /** For condition nodes, how many subsequent nodes belong to the then-branch. */
  thenCount?: number
  /** For condition nodes, whether the then-branch ends with a return. */
  thenReturns?: boolean
  /** For invoke nodes, the target function reference. */
  target?: string
  /** Retry strategy name if present. */
  retryStrategy?: string
  /** Timeout config if present. */
  timeout?: string
  /** Source line number (1-based) where this primitive appears. */
  sourceLine?: number
}

export interface WorkflowBranch {
  name: string
  /** Whether this branch is dynamically generated (e.g. from .map()). */
  dynamic: boolean
  nodes: WorkflowNode[]
}

export interface WorkflowEdge {
  from: string
  to: string
  label?: string
}

export interface WorkflowGraph {
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/**
 * Build edges from an ordered list of nodes, handling parallel fan-out/fan-in
 * and conditional branches.
 */
export function buildEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
  const edges: WorkflowEdge[] = []

  // Build a set of node indices that are the last node in a then-branch
  // that returns — these should connect to End, not the next sequential node.
  const thenTerminals = new Set<number>()
  // Track ranges of then-branch nodes so we can suppress the automatic
  // edge from the last then-node to the next sequential node.
  const thenRanges: { start: number; end: number; returns: boolean }[] = []

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].kind === 'condition') {
      const thenCount = nodes[i].thenCount ?? 1
      const returns = nodes[i].thenReturns === true
      const rangeStart = i + 1
      const rangeEnd = i + thenCount // inclusive
      thenRanges.push({ start: rangeStart, end: rangeEnd, returns })
      if (returns) {
        thenTerminals.add(rangeEnd)
      }
    }
  }

  // Find the End node
  const endNode = nodes.find((n) => n.kind === 'end')

  for (let i = 0; i < nodes.length - 1; i++) {
    const current = nodes[i]
    const next = nodes[i + 1]

    if ((current.kind === 'parallel' || current.kind === 'map') && current.branches?.length) {
      // Fan out from parallel node to each branch start
      const fanInTarget = thenTerminals.has(i) && endNode ? endNode : next
      for (const branch of current.branches) {
        if (branch.nodes.length > 0) {
          // Skip edge label when it matches the target node label (avoids redundancy)
          const firstNode = branch.nodes[0]
          const edgeLabel = firstNode.label === branch.name ? undefined : branch.name
          edges.push({ from: current.id, to: firstNode.id, label: edgeLabel })
          for (let j = 0; j < branch.nodes.length - 1; j++) {
            edges.push({ from: branch.nodes[j].id, to: branch.nodes[j + 1].id })
          }
          const last = branch.nodes[branch.nodes.length - 1]
          edges.push({ from: last.id, to: fanInTarget.id })
        }
      }
    } else if (current.kind === 'condition') {
      const thenCount = current.thenCount ?? 1
      // "yes" edge → first then-branch node
      edges.push({ from: current.id, to: next.id, label: 'yes' })
      // "no" edge → skip past then-branch
      const skipTarget = nodes[i + 1 + thenCount]
      if (skipTarget) {
        edges.push({ from: current.id, to: skipTarget.id, label: 'no' })
      }
    } else if (thenTerminals.has(i)) {
      // Last node in a then-branch that returns — connect to End
      if (endNode) {
        edges.push({ from: current.id, to: endNode.id })
      }
    } else {
      edges.push({ from: current.id, to: next.id })
    }
  }

  return edges
}
