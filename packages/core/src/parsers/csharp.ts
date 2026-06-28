/**
 * C# parser for AWS Lambda Durable Execution SDK (.NET).
 *
 * Uses regex-based parsing to find durable workflow functions and extract
 * primitives. The .NET SDK is in preview (0.x) and uses Async-suffixed
 * methods on IDurableContext:
 *
 *   ctx.StepAsync(...)              → step
 *   ctx.WaitAsync(...)              → wait
 *   ctx.CreateCallbackAsync(...)    → createCallback
 *   ctx.WaitForCallbackAsync(...)   → waitForCallback
 *   ctx.WaitForConditionAsync(...)  → waitForCondition
 *   ctx.RunInChildContextAsync(...) → runInChildContext
 *   ctx.InvokeAsync(...)            → invoke
 *   ctx.ParallelAsync(...)          → parallel
 *   ctx.MapAsync(...)               → map
 *
 * Entry points — two programming models:
 *   Executable:  HandlerWrapper.GetHandlerWrapper + LambdaBootstrap
 *   Class-library: [assembly: LambdaSerializer(...)] + plain Handler
 *
 * Both delegate to DurableFunction.WrapAsync<TInput, TOutput>(Workflow, ...)
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
// Primitive mapping: C# method name → graph NodeKind
// ---------------------------------------------------------------------------

interface PrimitiveInfo {
  kind: WorkflowNode['kind']
  idPrefix: string
}

const PRIMITIVES: Record<string, PrimitiveInfo> = {
  'StepAsync': { kind: 'step', idPrefix: 'step' },
  'WaitAsync': { kind: 'wait', idPrefix: 'wait' },
  'CreateCallbackAsync': { kind: 'createCallback', idPrefix: 'createcb' },
  'WaitForCallbackAsync': { kind: 'waitForCallback', idPrefix: 'callback' },
  'WaitForConditionAsync': { kind: 'waitForCondition', idPrefix: 'waitcond' },
  'RunInChildContextAsync': { kind: 'runInChildContext', idPrefix: 'child' },
  'InvokeAsync': { kind: 'invoke', idPrefix: 'invoke' },
  'ParallelAsync': { kind: 'parallel', idPrefix: 'parallel' },
  'MapAsync': { kind: 'map', idPrefix: 'map' },
}

// ---------------------------------------------------------------------------
// C#-specific parsing
// ---------------------------------------------------------------------------

/**
 * Find the IDurableContext parameter name from all method signatures.
 * Pattern: IDurableContext ctx  or  IDurableContext context
 */
function findContextParam(source: string): string[] {
  const paramPattern = /IDurableContext\s+(\w+)/g
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
 * Find the workflow function passed to DurableFunction.WrapAsync.
 * Pattern: DurableFunction.WrapAsync<...>(WorkflowName, input, context)
 * Returns the workflow function name.
 */
function findWorkflowFunctionName(source: string): string | null {
  const pattern = /DurableFunction\.WrapAsync\s*<\s*[\w,.\s]+\s*>\s*\(\s*(\w+)\s*,/g
  let match
  while ((match = pattern.exec(source)) !== null) {
    return match[1]
  }
  return null
}

/**
 * Find and extract the body of a named method.
 */
function findMethodBody(source: string, methodName: string): string | null {
  const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?:private|protected|public|internal|static|async|\\s)+` +
    `[\\w<>,\\[\\]\\s]+\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`
  )
  const match = pattern.exec(source)
  if (!match) return null

  const startIdx = match.index + match[0].length
  return extractBlock(source, startIdx)
}

/**
 * Extract a brace-delimited block.
 */
function extractBlock(source: string, startIdx: number): string {
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
 * Extract durable primitives from a block of C# code.
 */
function extractNodes(
  body: string,
  contextNames: string[],
  source: string,
  baseLineOffset: number,
): WorkflowNode[] {
  const nodes: WorkflowNode[] = []
  const lines = body.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const absLine = baseLineOffset + i

    if (line.startsWith('//') || line.startsWith('/*') || line === '') continue

    // if (condition) { ... } or Allman-style if (condition)\n{ → condition node
    const ifMatch = line.match(/^if\s*\((.+?)\)/)
    if (ifMatch) {
      let braceIdx = body.indexOf('{', body.indexOf(line))
      // Handle Allman style: brace on next line
      if (braceIdx === -1 || body.slice(body.indexOf(line) + line.length, braceIdx).trim() !== '') {
        // Look from the start of the line after if
        const lineEnd = body.indexOf('\n', body.indexOf(line))
        const afterLine = lineEnd >= 0 ? body.indexOf('{', lineEnd) : -1
        if (afterLine >= 0) braceIdx = afterLine
      }
      if (braceIdx < 0) continue

      const condition = ifMatch[1]
      const ifBody = extractBlock(body, braceIdx + 1)
      const ifBodyOffset = baseLineOffset + i + 1
      const thenNodes = extractNodes(ifBody, contextNames, source, ifBodyOffset)

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

    // Durable primitives
    let matched = false
    for (const method of Object.keys(PRIMITIVES)) {
      if (matched) break
      for (const ctxName of contextNames) {
        const callPattern = new RegExp(`${ctxName}\\.${method}\\s*(?:<[^>]+>)?\\s*\\(`)
        if (!callPattern.test(line)) continue

        matched = true
        const info = PRIMITIVES[method]
        const nameArg = extractNameArg(lines, i)

        const node: WorkflowNode = {
          id: nextId(info.idPrefix),
          kind: info.kind,
          label: nameArg ?? method.replace(/Async$/, '').replace(/([A-Z])/g, ' $1').toLowerCase().trim(),
          sourceLine: absLine,
        }

        if (info.kind === 'invoke') {
          const invokeText = joinCallLines(lines, i)
          const fnMatch = invokeText.match(/InvokeAsync\s*<\s*[\w,\s]+\s*>\s*\(\s*(?:functionName:\s*)?\s*"([^"]+)"/)
          if (fnMatch) node.target = fnMatch[1]
        }

        if (info.kind === 'parallel' || info.kind === 'map') {
          node.branches = extractCSharpBranches(lines, i)
          const config = extractCSharpConfig(lines, i)
          if (config.nestingType) node.nestingType = config.nestingType
          if (config.completionConfig) node.completionConfig = config.completionConfig
        }

        if (info.kind === 'runInChildContext') {
          const config = extractCSharpConfig(lines, i)
          if (config.nestingType) node.nestingType = config.nestingType
        }

        nodes.push(node)
        break
      }
    }
  }

  return nodes
}

/**
 * Join multiple lines of a method call until parentheses balance.
 */
function joinCallLines(lines: string[], startIdx: number): string {
  let depth = 0
  let started = false
  const parts: string[] = []
  for (let i = startIdx; i < lines.length; i++) {
    parts.push(lines[i])
    for (const ch of lines[i]) {
      if (ch === '(') { started = true; depth++ }
      else if (ch === ')') depth--
    }
    if (started && depth === 0) break
  }
  return parts.join(' ')
}

/**
 * Extract the label from a durable call.
 * Looks for `name: "label"` named argument pattern common in C#.
 */
function extractNameArg(lines: string[], lineIdx: number): string | undefined {
  const callText = joinCallLines(lines, lineIdx)

  // name: "label"  or  name:"label"
  const nameMatch = callText.match(/name:\s*"([^"]+)"/)
  if (nameMatch) return nameMatch[1]

  // First string argument: ctx.MethodAsync("label"
  const strMatch = callText.match(/\.\w+Async\s*<\s*[\w,\s]+\s*>\s*\(\s*"([^"]+)"/)
  if (strMatch) return strMatch[1]

  // No generics: ctx.MethodAsync("label"
  const simpleStr = callText.match(/\.\w+Async\s*\(\s*"([^"]+)"/)
  if (simpleStr) return simpleStr[1]

  // Function call as first arg: ctx.MethodAsync(FuncName
  const fnMatch = callText.match(/\.\w+Async\s*<\s*[\w,\s]+\s*>\s*\(\s*(\w+)\s*\(/)
  if (fnMatch) return fnMatch[1]

  // Non-generic function arg
  const fnSimple = callText.match(/\.\w+Async\s*\(\s*(\w+)\s*\(/)
  if (fnSimple) return fnSimple[1]

  // Dotted identifier: ctx.MethodAsync(something.Name
  const dottedMatch = callText.match(/\.\w+Async\s*\(\s*(\w+\.\w+)/)
  if (dottedMatch) return dottedMatch[1]

  // Variable reference
  const varMatch = callText.match(/\.\w+Async[\s<][^(]*\(\s*(\w+)\s*[,)]/)
  if (varMatch && !['null', 'true', 'false', 'this'].includes(varMatch[1])) return varMatch[1]

  return undefined
}

/**
 * Extract branch names from ParallelAsync / MapAsync calls.
 * Handles:
 *   new DurableBranch<T>("name", ...)
 *   new[] { new DurableBranch<T>(...), ... }
 */
function extractCSharpBranches(lines: string[], startLine: number): WorkflowBranch[] {
  const branches: WorkflowBranch[] = []
  const searchText = lines.slice(startLine, startLine + 40).join('\n')

  const branchPattern = /new\s+DurableBranch\s*<\s*\w+\s*>\s*\(\s*"([^"]+)"/g
  let match
  while ((match = branchPattern.exec(searchText)) !== null) {
    branches.push({
      name: match[1],
      dynamic: false,
      nodes: [{
        id: nextId('step'),
        kind: 'step',
        label: match[1],
      }],
    })
  }

  return branches
}

/**
 * Extract config-level flags from surrounding lines.
 */
interface CSharpConfigFlags {
  nestingType?: string
  completionConfig?: string
}

function extractCSharpConfig(lines: string[], lineIdx: number): CSharpConfigFlags {
  const flags: CSharpConfigFlags = {}
  const searchText = lines.slice(lineIdx, lineIdx + 20).join(' ')

  const nesting = searchText.match(/\.NestingType\s*=\s*NestingType\.(\w+)/)
  if (nesting) flags.nestingType = nesting[1]

  const completion = searchText.match(/\.CompletionConfig\s*=\s*CompletionConfig\.(\w+)\(\s*\)/)
  if (completion) flags.completionConfig = completion[1].replace(/([A-Z])/g, ' $1').toLowerCase().trim()

  return flags
}

/**
 * Compute the 1-based line number of a substring within the full source.
 */
function lineOfSubstring(source: string, substring: string): number {
  const idx = source.indexOf(substring)
  if (idx === -1) return 0
  return source.slice(0, idx).split('\n').length
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class CSharpParser implements Parser {
  extensions = ['.cs']

  parseFile(filePath: string, options?: ParseOptions): WorkflowGraph {
    resetIds()

    const source = readFileSync(filePath, 'utf-8')
    const fileName = basename(filePath, '.cs')
    const name = options?.name ?? fileName

    // Find the workflow function name from DurableFunction.WrapAsync
    const workflowName = findWorkflowFunctionName(source)
    if (!workflowName) {
      throw new Error(`No DurableFunction.WrapAsync call found in ${filePath}`)
    }

    // Find and extract the workflow function body
    const workflowBody = findMethodBody(source, workflowName)
    if (!workflowBody) {
      throw new Error(`Workflow function '${workflowName}' not found in ${filePath}`)
    }

    const contextNames = findContextParam(source)

    const workflowOffset = lineOfSubstring(source, workflowBody)
    const workflowNodes = extractNodes(workflowBody, contextNames, source, workflowOffset)

    const startNode: WorkflowNode = { id: 'node_start', kind: 'start', label: 'Start' }
    const endNode: WorkflowNode = { id: 'node_end', kind: 'end', label: 'End' }
    const allNodes = [startNode, ...workflowNodes, endNode]
    const edges = buildEdges(allNodes)

    return { name, nodes: allNodes, edges }
  }
}
