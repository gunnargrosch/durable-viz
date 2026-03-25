/**
 * Python parser for durable function handlers.
 *
 * Uses regex-based parsing to find @durable_execution decorated handlers
 * and extract durable primitives. Python SDK uses snake_case method names:
 *
 *   context.step()              → step
 *   context.invoke()            → invoke
 *   context.parallel()          → parallel
 *   context.map()               → map
 *   context.wait()              → wait
 *   context.wait_for_callback() → waitForCallback
 *   context.create_callback()   → createCallback
 *   context.wait_for_condition()→ waitForCondition
 *   context.run_in_child_context() → runInChildContext
 */

import { readFileSync } from 'node:fs'
import type { WorkflowNode, WorkflowBranch, WorkflowGraph } from '../graph.js'
import { buildEdges } from '../graph.js'
import type { Parser, ParseOptions } from '../parser.js'
import { basename } from 'node:path'

let nodeCounter = 0
function nextId(prefix: string): string {
  return `${prefix}_${++nodeCounter}`
}
function resetIds(): void {
  nodeCounter = 0
}

// ---------------------------------------------------------------------------
// Primitive mapping: Python method name → graph NodeKind
// ---------------------------------------------------------------------------

interface PrimitiveInfo {
  kind: WorkflowNode['kind']
  idPrefix: string
}

const PRIMITIVES: Record<string, PrimitiveInfo> = {
  'step': { kind: 'step', idPrefix: 'step' },
  'invoke': { kind: 'invoke', idPrefix: 'invoke' },
  'parallel': { kind: 'parallel', idPrefix: 'parallel' },
  'map': { kind: 'map', idPrefix: 'map' },
  'wait': { kind: 'wait', idPrefix: 'wait' },
  'wait_for_callback': { kind: 'waitForCallback', idPrefix: 'callback' },
  'create_callback': { kind: 'createCallback', idPrefix: 'createcb' },
  'wait_for_condition': { kind: 'waitForCondition', idPrefix: 'waitcond' },
  'run_in_child_context': { kind: 'runInChildContext', idPrefix: 'child' },
}

// ---------------------------------------------------------------------------
// Python-specific parsing
// ---------------------------------------------------------------------------

/**
 * Find the context parameter name from a @durable_execution handler.
 * Pattern: def handler(event: dict, context: DurableContext)
 * Returns the parameter name (e.g. "context", "ctx").
 */
function findContextParam(handlerBody: string): string[] {
  const paramPattern = /def\s+\w+\s*\([^)]*?(\w+)\s*:\s*DurableContext/g
  const names: string[] = []
  let match
  while ((match = paramPattern.exec(handlerBody)) !== null) {
    names.push(match[1])
  }
  if (names.length === 0) {
    // Fallback: common names
    names.push('context', 'ctx')
  }
  return names
}

/**
 * Extract the handler function body starting from @durable_execution.
 * Returns the text of the decorated function.
 */
function extractHandlerBody(source: string): string | null {
  // Find @durable_execution decorator followed by def
  const decoratorPattern = /@durable_execution\s*\n\s*def\s+(\w+)\s*\([^)]*\)[^:]*:/
  const match = decoratorPattern.exec(source)
  if (!match) return null

  const startIdx = match.index + match[0].length
  // Extract the function body based on indentation
  return extractPythonBlock(source, startIdx)
}

/**
 * Extract a Python block (indentation-based) starting after a colon.
 */
function extractPythonBlock(source: string, startIdx: number): string {
  const lines = source.slice(startIdx).split('\n')
  const bodyLines: string[] = []
  let baseIndent: number | null = null

  for (const line of lines) {
    // Skip empty lines at the start
    if (baseIndent === null) {
      if (line.trim() === '') continue
      baseIndent = line.length - line.trimStart().length
      if (baseIndent === 0) break // not indented = not part of function body
      bodyLines.push(line)
      continue
    }

    // Empty lines are part of the block
    if (line.trim() === '') {
      bodyLines.push(line)
      continue
    }

    const indent = line.length - line.trimStart().length
    if (indent < baseIndent) break // dedented = end of block
    bodyLines.push(line)
  }

  return bodyLines.join('\n')
}

/**
 * Find helper functions that accept DurableContext and contain durable calls.
 */
function findHelperFunctions(source: string, contextNames: string[]): Map<string, string> {
  const helpers = new Map<string, string>()
  // Match: def func_name(..., param: DurableContext, ...):
  const funcPattern = /def\s+(\w+)\s*\(([^)]*DurableContext[^)]*)\)[^:]*:/g
  let match

  while ((match = funcPattern.exec(source)) !== null) {
    const funcName = match[1]
    const startIdx = match.index + match[0].length
    const body = extractPythonBlock(source, startIdx)

    // Check if the body contains durable calls
    const hasContextCall = contextNames.some((name) =>
      Object.keys(PRIMITIVES).some((method) =>
        body.includes(`${name}.${method}(`)
      )
    )

    if (hasContextCall) {
      helpers.set(funcName, body)
    }
  }

  return helpers
}

/**
 * Compute the 1-based line number of a substring within the full source.
 */
function lineOfSubstring(source: string, substring: string): number {
  const idx = source.indexOf(substring)
  if (idx === -1) return 0
  return source.slice(0, idx).split('\n').length
}

/**
 * Extract durable primitive calls from a block of Python code.
 *
 * @param body - the code block to scan
 * @param contextNames - DurableContext parameter names
 * @param helpers - helper functions that use DurableContext
 * @param visited - recursion guard
 * @param source - the full file source (for computing absolute line numbers)
 * @param baseLineOffset - 1-based line offset of body within source
 */
function extractNodes(
  body: string,
  contextNames: string[],
  helpers: Map<string, string>,
  visited: Set<string>,
  source: string,
  baseLineOffset: number,
): WorkflowNode[] {
  const nodes: WorkflowNode[] = []
  const lines = body.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const absLine = baseLineOffset + i

    // Skip comments and empty lines
    if (line.startsWith('#') || line === '') continue

    // Check for if-statements wrapping durable calls
    const ifMatch = line.match(/^if\s+(.+?)\s*:/)
    if (ifMatch) {
      const condition = ifMatch[1]
      const blockStart = body.indexOf(lines[i]) + lines[i].length
      const ifBody = extractPythonBlock(body, blockStart)
      const ifBodyOffset = baseLineOffset + i + 1
      const thenNodes = extractNodes(ifBody, contextNames, helpers, visited, source, ifBodyOffset)

      if (thenNodes.length > 0) {
        const ifLines = ifBody.trim().split('\n')
        const lastLine = ifLines[ifLines.length - 1]?.trim() ?? ''
        const thenReturns = lastLine.startsWith('return ')

        nodes.push({
          id: nextId('cond'),
          kind: 'condition',
          label: condition,
          condition,
          thenCount: thenNodes.length,
          thenReturns,
          sourceLine: absLine,
        })
        nodes.push(...thenNodes)

        const ifBodyLines = ifBody.split('\n').length
        i += ifBodyLines
        continue
      }
    }

    // Check for durable primitive calls
    let matched = false
    for (const contextName of contextNames) {
      if (matched) break
      for (const [method, info] of Object.entries(PRIMITIVES)) {
        const callPattern = new RegExp(`${contextName}\\.${method}\\s*\\(`)
        if (!callPattern.test(line)) continue

        matched = true
        const nameArg = extractNameArg(line, lines, i)

        const node: WorkflowNode = {
          id: nextId(info.idPrefix),
          kind: info.kind,
          label: nameArg ?? method.replace(/_/g, ' '),
          sourceLine: absLine,
        }

        if (info.kind === 'invoke') {
          const fnMatch = line.match(/function_name\s*=\s*["']([^"']+)["']/)
            ?? line.match(/invoke\s*\(\s*["']([^"']+)["']/)
          if (fnMatch) node.target = fnMatch[1]
        }

        if (info.kind === 'parallel' || info.kind === 'map') {
          node.branches = extractPythonBranches(lines, i)
        }

        nodes.push(node)
        break
      }
    }

    // Check for helper function calls (only if no primitive matched)
    if (!matched) {
      for (const [funcName, helperBody] of helpers) {
        if (line.includes(`${funcName}(`) && !visited.has(funcName)) {
          visited.add(funcName)
          const helperOffset = lineOfSubstring(source, helperBody)
          const inlined = extractNodes(helperBody, contextNames, helpers, visited, source, helperOffset)
          nodes.push(...inlined)
          visited.delete(funcName)
        }
      }
    }
  }

  return nodes
}

/**
 * Extract the name= keyword argument from a Python call.
 */
function extractNameArg(line: string, lines: string[], lineIdx: number): string | undefined {
  // Check current and nearby lines for name= argument
  const searchText = lines.slice(lineIdx, lineIdx + 5).join(' ')
  const nameMatch = searchText.match(/name\s*=\s*["']([^"']+)["']/)
  return nameMatch?.[1]
}

/**
 * Try to extract branch names from a parallel/map call.
 * Looks for function references in the arguments.
 */
function extractPythonBranches(lines: string[], startLine: number): WorkflowBranch[] {
  const branches: WorkflowBranch[] = []
  // Look at the next several lines for function references in list
  const searchText = lines.slice(startLine, startLine + 20).join('\n')

  // Pattern: [func1, func2, func3] or [lambda ctx: ..., lambda ctx: ...]
  const listMatch = searchText.match(/\[\s*([^\]]+)\]/)
  if (listMatch) {
    const items = listMatch[1].split(',')
    for (const item of items) {
      const funcName = item.trim().split('(')[0].trim()
      if (funcName && !funcName.startsWith('lambda') && /^\w+$/.test(funcName)) {
        branches.push({
          name: funcName,
          dynamic: false,
          nodes: [{
            id: nextId('step'),
            kind: 'step',
            label: funcName,
          }],
        })
      }
    }
  }

  return branches
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class PythonParser implements Parser {
  extensions = ['.py']

  parseFile(filePath: string, options?: ParseOptions): WorkflowGraph {
    resetIds()

    const source = readFileSync(filePath, 'utf-8')
    const fileName = basename(filePath, '.py')
    const name = options?.name ?? fileName

    const handlerBody = extractHandlerBody(source)
    if (!handlerBody) {
      throw new Error(`No @durable_execution handler found in ${filePath}`)
    }

    const contextNames = findContextParam(source)
    const helpers = findHelperFunctions(source, contextNames)

    const handlerOffset = lineOfSubstring(source, handlerBody)
    const workflowNodes = extractNodes(handlerBody, contextNames, helpers, new Set(), source, handlerOffset)

    const startNode: WorkflowNode = { id: 'node_start', kind: 'start', label: 'Start' }
    const endNode: WorkflowNode = { id: 'node_end', kind: 'end', label: 'End' }
    const allNodes = [startNode, ...workflowNodes, endNode]
    const edges = buildEdges(allNodes)

    return { name, nodes: allNodes, edges }
  }
}
