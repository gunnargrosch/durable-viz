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
  | 'withRetry'
  | 'promiseAll'
  | 'promiseAny'
  | 'promiseRace'
  | 'promiseAllSettled'
  | 'condition'
  | 'loop'

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
  /** Nesting type for parallel/map/runInChildContext/withRetry nodes: "FLAT" or "NESTED". */
  nestingType?: string
  /** Completion config for parallel/map nodes (e.g. "firstSuccessful", "minSuccessful:3"). */
  completionConfig?: string
  /** Step semantics for step nodes: "AtMostOncePerRetry" or undefined for AtLeastOncePerRetry. */
  stepSemantics?: string
  /** Tenant ID for multi-tenant invoke operations. */
  tenantId?: string
  /** Concurrency limit for parallel/map nodes (e.g. maxConcurrency, max_concurrency). */
  maxConcurrency?: number
  /** For loop nodes, how many subsequent flat nodes belong to the loop body. */
  bodyCount?: number
  /** For loop nodes, the loop header text (e.g. "const order of orders"). */
  loopHeader?: string
  /** For loop nodes, the iteration count when it is a trivial literal (e.g. 3). */
  iterations?: number
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
  /** "back" marks an edge that returns to a loop header. */
  style?: 'back'
}

export interface WorkflowGraph {
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** Build the display label for a loop node. */
export function loopLabel(header: string, iterations?: number): string {
  const text = header.replace(/\s+/g, ' ').trim()
  const base = text ? `loop: ${text}` : 'loop'
  return iterations != null ? `${base} x${iterations}` : base
}

/**
 * Build edges from an ordered list of nodes, handling parallel fan-out/fan-in,
 * conditional branches and loops.
 *
 * Loops follow the same flat shape as conditions: a loop node is followed by
 * `bodyCount` nodes that belong to its body. The last body node returns to the
 * loop node with a "back" edge, and the loop node exits to the node after the
 * body with a "done" edge.
 */
export function buildEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
  const edges: WorkflowEdge[] = []

  // Build a set of node indices that are the last node in a then-branch
  // that returns — these should connect to End, not the next sequential node.
  const thenTerminals = new Set<number>()
  // Track ranges of then-branch nodes so we can suppress the automatic
  // edge from the last then-node to the next sequential node.
  const thenRanges: { start: number; end: number; returns: boolean }[] = []
  // Index of the last body node for each loop, keyed by loop node index.
  const loopEnds = new Map<number, number>()

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
    } else if (nodes[i].kind === 'loop') {
      const bodyCount = Math.max(nodes[i].bodyCount ?? 1, 1)
      loopEnds.set(i, Math.min(i + bodyCount, nodes.length - 1))
    }
  }

  /**
   * Where control goes after the node at `index` finishes. Normally the next
   * node, but the last node of a loop body goes back to the innermost loop
   * header that ends there. `after` skips loops at or past `before`, so a loop
   * can ask for the target that follows its own body.
   */
  const flowAfter = (index: number, before = Infinity): { target: WorkflowNode; back: boolean } | undefined => {
    let innermostLoop = -1
    for (const [loopIndex, endIndex] of loopEnds) {
      if (endIndex === index && loopIndex < before && loopIndex > innermostLoop) {
        innermostLoop = loopIndex
      }
    }
    if (innermostLoop >= 0) return { target: nodes[innermostLoop], back: true }
    const next = nodes[index + 1]
    return next ? { target: next, back: false } : undefined
  }

  const pushFlowEdge = (from: WorkflowNode, flow: { target: WorkflowNode; back: boolean } | undefined, label?: string) => {
    if (!flow) return
    const edge: WorkflowEdge = { from: from.id, to: flow.target.id }
    if (label) edge.label = label
    if (flow.back) {
      edge.style = 'back'
      edge.label = edge.label ?? 'next'
    }
    edges.push(edge)
  }

  // Find the End node
  const endNode = nodes.find((n) => n.kind === 'end')

  for (let i = 0; i < nodes.length - 1; i++) {
    const current = nodes[i]
    const next = nodes[i + 1]

    if ((current.kind === 'parallel' || current.kind === 'map') && current.branches?.length) {
      // Fan out from parallel node to each branch start
      const fanIn = thenTerminals.has(i) && endNode
        ? { target: endNode, back: false }
        : flowAfter(i)
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
          pushFlowEdge(last, fanIn)
        }
      }
    } else if (current.kind === 'loop') {
      // Enter the body, and exit to whatever follows it
      edges.push({ from: current.id, to: next.id })
      const bodyEnd = loopEnds.get(i) ?? i + 1
      const exit = flowAfter(bodyEnd, i)
      if (exit) {
        pushFlowEdge(current, exit, 'done')
      }
    } else if (current.kind === 'condition') {
      const thenCount = current.thenCount ?? 1
      // "yes" edge → first then-branch node
      edges.push({ from: current.id, to: next.id, label: 'yes' })
      // "no" edge → skip past then-branch (or back to the loop header when
      // the then-branch is the end of a loop body)
      pushFlowEdge(current, flowAfter(i + thenCount), 'no')
    } else if (thenTerminals.has(i)) {
      // Last node in a then-branch that returns — connect to End
      if (endNode) {
        edges.push({ from: current.id, to: endNode.id })
      }
    } else {
      pushFlowEdge(current, flowAfter(i))
    }
  }

  return edges
}
