/**
 * Java parser for durable function handlers.
 *
 * Uses regex-based parsing to find classes extending DurableHandler
 * and extract durable primitives. Java SDK uses camelCase:
 *
 *   ctx.step()              → step
 *   ctx.invoke()            → invoke
 *   ctx.map()               → map
 *   ctx.wait()              → wait
 *   ctx.waitForCallback()   → waitForCallback
 *   ctx.createCallback()    → createCallback
 *   ctx.waitForCondition()  → waitForCondition
 *   ctx.runInChildContext()  → runInChildContext
 *
 * Note: parallel() is not yet available in Java SDK (preview).
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
// Primitive mapping: Java method name → graph NodeKind
// ---------------------------------------------------------------------------

interface PrimitiveInfo {
  kind: WorkflowNode['kind']
  idPrefix: string
}

const PRIMITIVES: Record<string, PrimitiveInfo> = {
  'step': { kind: 'step', idPrefix: 'step' },
  'invoke': { kind: 'invoke', idPrefix: 'invoke' },
  'map': { kind: 'map', idPrefix: 'map' },
  'wait': { kind: 'wait', idPrefix: 'wait' },
  'waitForCallback': { kind: 'waitForCallback', idPrefix: 'callback' },
  'createCallback': { kind: 'createCallback', idPrefix: 'createcb' },
  'waitForCondition': { kind: 'waitForCondition', idPrefix: 'waitcond' },
  'runInChildContext': { kind: 'runInChildContext', idPrefix: 'child' },
  'parallel': { kind: 'parallel', idPrefix: 'parallel' },
}

// ---------------------------------------------------------------------------
// Java-specific parsing
// ---------------------------------------------------------------------------

/**
 * Find the DurableContext parameter name from the handleRequest method.
 * Pattern: protected OrderResult handleRequest(Order order, DurableContext ctx)
 */
function findContextParam(source: string): string[] {
  const paramPattern = /DurableContext\s+(\w+)/g
  const names = new Set<string>()
  let match
  while ((match = paramPattern.exec(source)) !== null) {
    names.add(match[1])
  }
  if (names.size === 0) {
    names.add('ctx')
    names.add('context')
  }
  return [...names]
}

/**
 * Extract the handleRequest method body from a DurableHandler subclass.
 */
function extractHandlerBody(source: string): string | null {
  // Find class extending DurableHandler
  const classPattern = /class\s+\w+\s+extends\s+DurableHandler\s*<[^>]*>/
  if (!classPattern.test(source)) return null

  // Find handleRequest method
  const methodPattern = /(?:protected|public)\s+\w+\s+handleRequest\s*\([^)]*DurableContext[^)]*\)\s*\{/
  const match = methodPattern.exec(source)
  if (!match) return null

  const startIdx = match.index + match[0].length
  return extractJavaBlock(source, startIdx)
}

/**
 * Extract a Java block (brace-delimited) starting after an opening brace.
 */
function extractJavaBlock(source: string, startIdx: number): string {
  let depth = 1
  let i = startIdx

  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }

  return source.slice(startIdx, i - 1)
}

/**
 * Find helper methods that accept DurableContext and contain durable calls.
 */
function findHelperMethods(source: string, contextNames: string[]): Map<string, string> {
  const helpers = new Map<string, string>()
  // Match methods with DurableContext parameter (not handleRequest)
  const methodPattern = /(?:private|protected|public)\s+\w+\s+(\w+)\s*\(([^)]*DurableContext[^)]*)\)\s*(?:throws\s+\w+\s*)?\{/g
  let match

  while ((match = methodPattern.exec(source)) !== null) {
    const methodName = match[1]
    if (methodName === 'handleRequest') continue

    const startIdx = match.index + match[0].length
    const body = extractJavaBlock(source, startIdx)

    const hasContextCall = contextNames.some((name) =>
      Object.keys(PRIMITIVES).some((method) =>
        body.includes(`${name}.${method}(`)
      )
    )

    if (hasContextCall) {
      helpers.set(methodName, body)
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
 * Extract durable primitive calls from a block of Java code.
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
    if (line.startsWith('//') || line.startsWith('/*') || line === '') continue

    // Check for if-statements wrapping durable calls
    const ifMatch = line.match(/^if\s*\((.+?)\)\s*\{/)
    if (ifMatch) {
      const condition = ifMatch[1]
      const blockStartIdx = body.indexOf(lines[i]) + lines[i].length
      const braceIdx = body.indexOf('{', blockStartIdx - lines[i].length) + 1
      const ifBody = extractJavaBlock(body, braceIdx)
      const ifBodyOffset = baseLineOffset + i + 1
      const thenNodes = extractNodes(ifBody, contextNames, helpers, visited, source, ifBodyOffset)

      if (thenNodes.length > 0) {
        const thenReturns = ifBody.trim().split('\n').pop()?.trim().startsWith('return ') ?? false

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
        i += ifBodyLines + 1
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
          label: nameArg ?? method.replace(/([A-Z])/g, ' $1').toLowerCase().trim(),
          sourceLine: absLine,
        }

        if (info.kind === 'invoke') {
          const fnMatch = line.match(/invoke\s*\(\s*"([^"]+)"/)
          if (fnMatch) node.target = fnMatch[1]
        }

        nodes.push(node)
        break
      }
    }

    // Check for helper method calls
    if (!matched) {
      for (const [methodName, helperBody] of helpers) {
        if (line.includes(`${methodName}(`) && !visited.has(methodName)) {
          visited.add(methodName)
          const helperOffset = lineOfSubstring(source, helperBody)
          const inlined = extractNodes(helperBody, contextNames, helpers, visited, source, helperOffset)
          nodes.push(...inlined)
          visited.delete(methodName)
        }
      }
    }
  }

  return nodes
}

/**
 * Extract the first string literal argument (step/invoke name) from a Java call.
 */
function extractNameArg(line: string, lines: string[], lineIdx: number): string | undefined {
  // Java pattern: ctx.step("name", Class.class, stepCtx -> ...)
  const searchText = lines.slice(lineIdx, lineIdx + 3).join(' ')
  // Match first string argument: ctx.method("name"
  const nameMatch = searchText.match(/\.\w+\s*\(\s*"([^"]+)"/)
  return nameMatch?.[1]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class JavaParser implements Parser {
  extensions = ['.java']

  parseFile(filePath: string, options?: ParseOptions): WorkflowGraph {
    resetIds()

    const source = readFileSync(filePath, 'utf-8')
    const fileName = basename(filePath, '.java')
    const name = options?.name ?? fileName

    const handlerBody = extractHandlerBody(source)
    if (!handlerBody) {
      throw new Error(`No DurableHandler subclass found in ${filePath}`)
    }

    const contextNames = findContextParam(source)
    const helpers = findHelperMethods(source, contextNames)

    const handlerOffset = lineOfSubstring(source, handlerBody)
    const workflowNodes = extractNodes(handlerBody, contextNames, helpers, new Set(), source, handlerOffset)

    const startNode: WorkflowNode = { id: 'node_start', kind: 'start', label: 'Start' }
    const endNode: WorkflowNode = { id: 'node_end', kind: 'end', label: 'End' }
    const allNodes = [startNode, ...workflowNodes, endNode]
    const edges = buildEdges(allNodes)

    return { name, nodes: allNodes, edges }
  }
}
