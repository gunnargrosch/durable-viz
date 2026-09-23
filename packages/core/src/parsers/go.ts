/**
 * Go parser for the AWS Durable Execution SDK for Go (preview).
 *
 * Uses regex-based parsing to find `durable.Start(handler)` entry points and
 * extract the package-level generic primitive functions. The Go SDK uses
 * free functions whose first argument is the durable Context and whose second
 * argument is the operation name:
 *
 *   durable.Step(ctx, "greet", func(sc durable.StepContext) (string, error) { ... })
 *   durable.Wait(ctx, "cooling-off", 5*time.Second)
 *   durable.Invoke[Receipt](ctx, "charge", paymentFnArn, order, durable.WithTenantID("t1"))
 *   durable.Parallel(ctx, "fanout", []durable.Branch[string]{
 *       {Name: "a", Func: func(ctx durable.Context) (string, error) { ... }},
 *   }, durable.WithMaxConcurrency(2))
 *
 * Concurrency combinators `All`, `AllSettled`, `Any`, `Race`, and `Select`
 * map to the promise-combinator kinds. `Go` runs durable work concurrently on
 * a child context and maps to runInChildContext.
 *
 * Structural scanning (brace/paren matching, argument splitting) is done over
 * a length-preserving "mask" of the source in which string, rune, and comment
 * contents are blanked. Positions and line numbers therefore line up with the
 * original text, while delimiters that appear inside strings, runes, or
 * comments cannot confuse the scanner.
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
// Primitive mapping: Go function name → graph NodeKind
// ---------------------------------------------------------------------------

interface PrimitiveInfo {
  kind: WorkflowNode['kind']
  idPrefix: string
}

const PRIMITIVES: Record<string, PrimitiveInfo> = {
  'Step': { kind: 'step', idPrefix: 'step' },
  'StepAsync': { kind: 'step', idPrefix: 'step' },
  'Invoke': { kind: 'invoke', idPrefix: 'invoke' },
  'InvokeAsync': { kind: 'invoke', idPrefix: 'invoke' },
  'Parallel': { kind: 'parallel', idPrefix: 'parallel' },
  'Map': { kind: 'map', idPrefix: 'map' },
  'Wait': { kind: 'wait', idPrefix: 'wait' },
  'WaitAsync': { kind: 'wait', idPrefix: 'wait' },
  'WaitForCallback': { kind: 'waitForCallback', idPrefix: 'callback' },
  'CreateCallback': { kind: 'createCallback', idPrefix: 'createcb' },
  'WaitForCondition': { kind: 'waitForCondition', idPrefix: 'waitcond' },
  'RunInChildContext': { kind: 'runInChildContext', idPrefix: 'child' },
  'RunInChildContextAsync': { kind: 'runInChildContext', idPrefix: 'child' },
  'Go': { kind: 'runInChildContext', idPrefix: 'go' },
  'Retry': { kind: 'withRetry', idPrefix: 'retry' },
  'All': { kind: 'promiseAll', idPrefix: 'all' },
  'Join': { kind: 'promiseAll', idPrefix: 'join' },
  'AllSettled': { kind: 'promiseAllSettled', idPrefix: 'allsettled' },
  'Any': { kind: 'promiseAny', idPrefix: 'any' },
  'Race': { kind: 'promiseRace', idPrefix: 'race' },
  'Select': { kind: 'promiseRace', idPrefix: 'select' },
}

const METHOD_NAMES = Object.keys(PRIMITIVES)

// ---------------------------------------------------------------------------
// Length-preserving masking of strings, runes, and comments
// ---------------------------------------------------------------------------

/**
 * Return a copy of `text` with the contents of string literals, rune
 * literals, and comments replaced by spaces. Newlines and the overall length
 * are preserved, so an index into the mask is also a valid index into the
 * original text.
 */
function maskCode(text: string): string {
  const out = text.split('')
  const len = text.length
  const blank = (i: number) => {
    if (out[i] !== '\n') out[i] = ' '
  }

  let i = 0
  while (i < len) {
    const ch = text[i]
    const next = text[i + 1]

    if (ch === '/' && next === '/') {
      while (i < len && text[i] !== '\n') {
        blank(i)
        i++
      }
      continue
    }

    if (ch === '/' && next === '*') {
      blank(i)
      blank(i + 1)
      i += 2
      while (i < len && !(text[i] === '*' && text[i + 1] === '/')) {
        blank(i)
        i++
      }
      if (i < len) {
        blank(i)
        blank(i + 1)
        i += 2
      }
      continue
    }

    if (ch === '"' || ch === '`' || ch === "'") {
      const quote = ch
      blank(i)
      i++
      while (i < len) {
        if (quote !== '`' && text[i] === '\\') {
          blank(i)
          i++
          if (i < len) {
            blank(i)
            i++
          }
          continue
        }
        if (text[i] === quote) {
          blank(i)
          i++
          break
        }
        blank(i)
        i++
      }
      continue
    }

    i++
  }

  return out.join('')
}

// ---------------------------------------------------------------------------
// Generic Go parsing helpers
// ---------------------------------------------------------------------------

/** Find the package alias used for the durable SDK import (default "durable"). */
function findPackageAlias(source: string): string {
  const match = source.match(/(\w+)\s+"github\.com\/aws\/aws-durable-execution-sdk-go\/durable"/)
  const alias = match?.[1]
  if (!alias || alias === 'import') return 'durable'
  return alias
}

/**
 * Extract a brace-delimited block whose opening brace is at `openIdx`.
 * `mask` is `maskCode(text)`; braces inside strings/comments are ignored.
 * Returns the block content without the outer braces.
 */
function extractBlock(text: string, mask: string, openIdx: number): string {
  let depth = 1
  let i = openIdx + 1
  while (i < text.length && depth > 0) {
    const ch = mask[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    i++
  }
  return text.slice(openIdx + 1, i - 1)
}

/** Compute the 1-based line number of a substring within the full source. */
function lineOfSubstring(source: string, substring: string): number {
  const idx = source.indexOf(substring)
  if (idx === -1) return 0
  return source.slice(0, idx).split('\n').length
}

/**
 * Find the handler body: the named function passed to `<alias>.Start()` or
 * `<alias>.Wrap()` (or an inline function literal).
 */
function extractHandlerBody(
  source: string,
  alias: string,
): { name?: string; body: string; offset: number } | null {
  const mask = maskCode(source)
  const entryPattern = new RegExp(`\\b${alias}\\.(?:Start|Wrap)(?:\\[[^\\]]*\\])?\\s*\\(`)
  const entry = entryPattern.exec(mask)
  if (!entry) return null

  const argStart = entry.index + entry[0].length
  const argHead = mask.slice(argStart, argStart + 120)

  // Inline function literal: Start(func(ctx durable.Context, ...) ... { ... })
  if (/^\s*func\s*\(/.test(argHead)) {
    const braceIdx = mask.indexOf('{', argStart)
    if (braceIdx === -1) return null
    const body = extractBlock(source, mask, braceIdx)
    return { body, offset: lineOfSubstring(source, body) }
  }

  // Named function: Start(handler) → func handler(...) { ... }
  const nameMatch = argHead.match(/^\s*(\w+)\s*[,)]/)
  if (!nameMatch) return null
  const fnName = nameMatch[1]
  const fnPattern = new RegExp(`\\bfunc\\s+${fnName}\\s*\\(`)
  const fnMatch = fnPattern.exec(mask)
  if (!fnMatch) return null

  const braceIdx = findSignatureBrace(mask, fnMatch.index + fnMatch[0].length)
  if (braceIdx === -1) return null
  const body = extractBlock(source, mask, braceIdx)
  return { name: fnName, body, offset: lineOfSubstring(source, body) }
}

/**
 * Find the opening brace of a function body, skipping the parameter and
 * result lists. Go result types may themselves contain parentheses (e.g.
 * `(O, error)`), so scan for the first `{` at paren depth zero.
 */
function findSignatureBrace(mask: string, startIdx: number): number {
  let depth = 0
  for (let i = startIdx; i < mask.length; i++) {
    const ch = mask[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '{' && depth <= 0) return i
    else if (ch === ';' && depth <= 0) return -1
  }
  return -1
}

/**
 * Find helper functions that accept a durable Context and contain durable
 * operations, so their calls can be inlined at the call site.
 */
function findHelperFunctions(
  source: string,
  alias: string,
  entryHandler?: string,
): Map<string, { body: string; offset: number }> {
  const helpers = new Map<string, { body: string; offset: number }>()
  const mask = maskCode(source)
  const funcPattern = new RegExp(`\\bfunc\\s+(\\w+)\\s*\\(([^)]*${alias}\\.Context[^)]*)\\)`, 'g')
  const callPattern = new RegExp(`\\b${alias}\\.(?:${METHOD_NAMES.join('|')})\\b`)

  let match
  while ((match = funcPattern.exec(mask)) !== null) {
    const funcName = match[1]
    if (funcName === entryHandler) continue

    const bodyStart = match.index + match[0].length
    const braceIdx = findSignatureBrace(mask, bodyStart)
    if (braceIdx === -1) continue
    const body = extractBlock(source, mask, braceIdx)

    if (callPattern.test(body)) {
      helpers.set(funcName, { body, offset: lineOfSubstring(source, body) })
    }
  }

  return helpers
}

/**
 * Collect a call's text by matching parentheses. Parentheses inside strings
 * and comments are ignored via the mask; the returned text is the original.
 */
function collectCallText(
  lines: string[],
  maskLines: string[],
  startLine: number,
  startChar: number,
): { text: string; endLine: number } {
  let depth = 0
  let started = false
  const parts: string[] = []

  for (let i = startLine; i < lines.length; i++) {
    const segment = i === startLine ? lines[i].slice(startChar) : lines[i]
    const maskSegment = i === startLine ? maskLines[i].slice(startChar) : maskLines[i]
    parts.push(segment)
    for (const ch of maskSegment) {
      if (ch === '(') { started = true; depth++ }
      else if (ch === ')') depth--
    }
    if (started && depth <= 0) return { text: parts.join('\n'), endLine: i }
  }
  return { text: parts.join('\n'), endLine: lines.length - 1 }
}

/** Split a call's top-level comma-separated arguments, respecting nesting and literals. */
function splitTopLevelArgs(text: string): string[] {
  const open = text.indexOf('(')
  if (open < 0) return []
  const args: string[] = []
  let depth = 1
  let current = ''
  let i = open + 1

  while (i < text.length) {
    const ch = text[i]

    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === '"' || ch === '`' || ch === "'") {
      const quote = ch
      current += ch
      i++
      while (i < text.length) {
        current += text[i]
        if (quote !== '`' && text[i] === '\\') {
          i++
          if (i < text.length) current += text[i]
          i++
          continue
        }
        if (text[i] === quote) { i++; break }
        i++
      }
      continue
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      current += ch
      i++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) { args.push(current); break }
      current += ch
      i++
      continue
    }
    if (ch === ',' && depth === 1) {
      args.push(current)
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }

  return args.map((a) => a.trim())
}

/**
 * Find a durable primitive call on a line. Handles optional generic type
 * arguments (including nested brackets) between the function name and the
 * opening paren, e.g. `durable.Invoke[map[string]int, []Foo](`.
 */
function findCallOnLine(
  maskLine: string,
  alias: string,
): { method: string; index: number; openParen: number } | null {
  const re = new RegExp(`\\b${alias}\\.(\\w+)`, 'g')
  let match
  while ((match = re.exec(maskLine)) !== null) {
    const method = match[1]
    if (!(method in PRIMITIVES)) continue

    let k = match.index + match[0].length
    while (maskLine[k] === ' ' || maskLine[k] === '\t') k++

    if (maskLine[k] === '[') {
      let depth = 0
      do {
        const ch = maskLine[k]
        if (ch === '[') depth++
        else if (ch === ']') depth--
        k++
      } while (k < maskLine.length && depth > 0)
      while (maskLine[k] === ' ' || maskLine[k] === '\t') k++
    }

    if (maskLine[k] === '(') {
      return { method, index: match.index, openParen: k }
    }
  }
  return null
}

/** Resolve a name/string argument to a display label. */
function labelFromArg(arg: string | undefined, source?: string): string | undefined {
  if (!arg) return undefined
  const str = arg.match(/^"((?:[^"\\]|\\.)*)"$/)
  if (str) return str[1] || undefined
  const raw = arg.match(/^`([^`]*)`$/)
  if (raw) return raw[1] || undefined
  if (/^[A-Za-z_][\w.]*$/.test(arg)) {
    if (source) {
      const resolved = resolveGoStringConst(source, arg)
      if (resolved !== undefined) return resolved || undefined
    }
    return arg
  }
  return undefined
}

/** Resolve `ident := "literal"` (or `=`, or `const ident =`) from the source. */
function resolveGoStringConst(source: string, ident: string): string | undefined {
  const match = source.match(new RegExp(`\\b${ident}\\s*:?=\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  return match?.[1]
}

/** Default label for an unnamed operation, matching the lowercase style of the other parsers. */
function defaultLabel(method: string): string {
  const base = method.replace(/Async$/, '')
  return base.charAt(0).toLowerCase() + base.slice(1)
}

// ---------------------------------------------------------------------------
// Config extraction
// ---------------------------------------------------------------------------

interface GoConfigFlags {
  nestingType?: string
  completionConfig?: string
  stepSemantics?: string
  tenantId?: string
  maxConcurrency?: number
  retryStrategy?: string
  timeout?: string
}

function extractGoConfig(callText: string, alias: string): GoConfigFlags {
  const flags: GoConfigFlags = {}

  const nesting = callText.match(/WithNesting\s*\(\s*(?:\w+\.)?Nesting(Nested|Flat)/)
  if (nesting) flags.nestingType = nesting[1].toUpperCase()
  if (new RegExp(`WithChildVirtual\\s*\\(`).test(callText)) flags.nestingType = 'FLAT'

  const concurrency = callText.match(/WithMaxConcurrency\s*\(\s*(\d+)/)
  if (concurrency) flags.maxConcurrency = Number(concurrency[1])

  const completion = callText.match(new RegExp(`WithCompletion\\s*\\(\\s*(?:\\w+\\.)?CompletionConfig\\s*\\{([\\s\\S]*?)\\}`))
  if (completion) {
    const parts: string[] = []
    const min = completion[1].match(/MinSuccessful\s*:\s*(\d+)/)
    if (min) parts.push(`minSuccessful:${min[1]}`)
    const count = completion[1].match(/ToleratedFailureCount\s*:\s*(?:\w+\.Int\()?\s*(\d+)/)
    if (count) parts.push(`toleratedFailures:${count[1]}`)
    const pct = completion[1].match(/ToleratedFailurePercentage\s*:\s*(?:\w+\.Int\()?\s*(\d+)/)
    if (pct) parts.push(`toleratedPct:${pct[1]}%`)
    flags.completionConfig = parts.length > 0 ? parts.join(' ') : 'completion'
  }

  const semantics = callText.match(/WithSemantics\s*\(\s*(?:\w+\.)?(AtMostOncePerRetry|AtLeastOncePerRetry)/)
  if (semantics) flags.stepSemantics = semantics[1]

  const tenant = callText.match(/WithTenantID\s*\(\s*"([^"]+)"/)
  if (tenant) flags.tenantId = tenant[1]

  const retry = callText.match(/WithRetry\s*\(\s*([^,)]+?)\s*\)/)
  if (retry) {
    const strategy = retry[1].trim()
    const named = strategy.match(new RegExp(`(?:${alias}\\.)?(\\w+)\\s*(?:\\(|$)`))
    flags.retryStrategy = named?.[1] ?? strategy
  }

  const timeout = callText.match(/With(?:Callback|CallbackHeartbeat)Timeout\s*\(\s*([^)]+?)\s*\)/)
  if (timeout) flags.timeout = timeout[1].trim()

  return flags
}

// ---------------------------------------------------------------------------
// Branch extraction
// ---------------------------------------------------------------------------

/** Extract parallel/select branch names from `durable.Branch[T]{Name: "..."}` literals. */
function extractBranches(callText: string): WorkflowBranch[] {
  const branches: WorkflowBranch[] = []
  const mask = maskCode(callText)
  const pattern = /Name\s*:\s*"([^"]*)"/g
  let match
  while ((match = pattern.exec(callText)) !== null) {
    // Ignore matches that fall inside a string or comment (masked to spaces).
    if (mask[match.index] === ' ') continue
    const name = match[1] || 'branch'
    branches.push({
      name,
      dynamic: false,
      nodes: [{ id: nextId('step'), kind: 'step', label: name }],
    })
  }
  return branches
}

/**
 * Map has no named branches; extract the durable operations inside its
 * per-item callback into a single representative branch.
 */
function extractMapBranch(
  callText: string,
  contextNames: string[],
  helpers: Map<string, { body: string; offset: number }>,
  source: string,
  callLineOffset: number,
  alias: string,
): WorkflowBranch[] {
  const mask = maskCode(callText)
  const fnMatch = mask.match(/func\s*\(([^)]*)\)\s*(?:\([^)]*\))?\s*\{/)
  if (!fnMatch) return []

  const braceIdx = fnMatch.index! + fnMatch[0].length - 1
  if (mask[braceIdx] !== '{') return []
  const body = extractBlock(callText, mask, braceIdx)

  const childContextNames = new Set(contextNames)
  const paramMatch = fnMatch[1].match(/(\w+)\s+\w+\.Context/)
  if (paramMatch) childContextNames.add(paramMatch[1])

  const newlineCount = callText.slice(0, braceIdx).split('\n').length - 1
  const bodyOffset = callLineOffset + newlineCount

  const inner = extractNodes(body, [...childContextNames], helpers, new Set(), source, bodyOffset, alias)

  return [{
    name: 'each item',
    dynamic: false,
    nodes: inner.length > 0
      ? inner
      : [{ id: nextId('step'), kind: 'step', label: 'process item' }],
  }]
}

// ---------------------------------------------------------------------------
// Core extraction logic
// ---------------------------------------------------------------------------

function extractNodes(
  body: string,
  contextNames: string[],
  helpers: Map<string, { body: string; offset: number }>,
  visited: Set<string>,
  source: string,
  baseLineOffset: number,
  alias = 'durable',
): WorkflowNode[] {
  const nodes: WorkflowNode[] = []
  const lines = body.split('\n')
  const bodyMask = maskCode(body)
  const maskLines = bodyMask.split('\n')

  // Character offset of each line within `body`, for locating braces.
  const lineStarts: number[] = []
  let acc = 0
  for (const line of lines) {
    lineStarts.push(acc)
    acc += line.length + 1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const maskLine = maskLines[i]
    const trimmed = line.trim()
    const maskTrimmed = maskLine.trim()
    const absLine = baseLineOffset + i

    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed === '') continue
    if (maskTrimmed === '') continue

    // if <condition> { ... } → condition node
    const ifHead = maskTrimmed.match(/^if\s+/)
    const braceInLine = maskTrimmed.indexOf('{')
    if (ifHead && braceInLine > 0) {
      const maskCondition = maskTrimmed.slice(ifHead[0].length, braceInLine)
      // Skip Go's initializer form (`if x, err := f(); err != nil {`). It is
      // error handling around a call, not a workflow branch, and its header
      // may itself contain a durable call with a function-literal body.
      if (!maskCondition.includes(':=') && !maskCondition.includes(';')) {
        const condition = trimmed.slice(ifHead[0].length, braceInLine).trim()
        const indent = line.length - line.trimStart().length
        const braceIdx = lineStarts[i] + indent + braceInLine
        const ifBody = extractBlock(body, bodyMask, braceIdx)
        const thenNodes = extractNodes(ifBody, contextNames, helpers, visited, source, absLine + 1, alias)

        if (thenNodes.length > 0) {
          const bodyLines = ifBody.trim().split('\n')
          const lastLine = bodyLines[bodyLines.length - 1]?.trim() ?? ''
          const thenReturns = /^return\b/.test(lastLine)

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
          i += ifBody.split('\n').length
          continue
        }
      }
    }

    // Durable primitive calls
    const call = findCallOnLine(maskTrimmed, alias)
    if (call) {
      const info = PRIMITIVES[call.method]
      const indent = line.length - line.trimStart().length
      const { text: callText, endLine } = collectCallText(lines, maskLines, i, indent + call.index)
      const args = splitTopLevelArgs(callText)
      const config = extractGoConfig(callText, alias)

      const node: WorkflowNode = {
        id: nextId(info.idPrefix),
        kind: info.kind,
        label: labelFromArg(args[1], source) ?? defaultLabel(call.method),
        sourceLine: absLine,
      }

      if (info.kind === 'invoke') {
        node.target = unquote(args[2])
        if (config.tenantId) node.tenantId = config.tenantId
      }

      if (info.kind === 'wait' && args[2]) {
        node.timeout = args[2]
      }

      if (info.kind === 'waitForCallback' || info.kind === 'createCallback') {
        if (config.timeout) node.timeout = config.timeout
      }

      if (info.kind === 'parallel') {
        node.branches = extractBranches(callText)
        if (config.nestingType) node.nestingType = config.nestingType
        if (config.completionConfig) node.completionConfig = config.completionConfig
        if (config.maxConcurrency != null) node.maxConcurrency = config.maxConcurrency
      }

      if (info.kind === 'map') {
        node.branches = extractMapBranch(callText, contextNames, helpers, source, absLine, alias)
        if (config.nestingType) node.nestingType = config.nestingType
        if (config.completionConfig) node.completionConfig = config.completionConfig
        if (config.maxConcurrency != null) node.maxConcurrency = config.maxConcurrency
      }

      if (info.kind === 'runInChildContext' && config.nestingType) {
        node.nestingType = config.nestingType
      }

      if (info.kind === 'step') {
        if (config.stepSemantics) node.stepSemantics = config.stepSemantics
        if (config.retryStrategy) node.retryStrategy = config.retryStrategy
      }

      if (info.kind === 'withRetry') {
        const strategyExpr = args[3]?.trim()
        if (strategyExpr) {
          const named = strategyExpr.match(new RegExp(`(?:${alias}\\.)?(\\w+)`))
          node.retryStrategy = named?.[1]
        }
      }

      nodes.push(node)

      // Skip lines consumed by this (possibly multi-line) call.
      i = Math.max(i, endLine)
      continue
    }

    // Helper function following: inline calls to same-file functions that
    // accept a durable Context and contain durable operations.
    for (const [funcName, helper] of helpers) {
      if (visited.has(funcName)) continue
      if (!new RegExp(`\\b${funcName}\\s*\\(`).test(maskLine)) continue

      visited.add(funcName)
      const inlined = extractNodes(
        helper.body,
        contextNames,
        helpers,
        visited,
        source,
        helper.offset,
        alias,
      )
      nodes.push(...inlined)
      visited.delete(funcName)
      break
    }
  }

  return nodes
}

/** Strip surrounding quotes from an argument expression. */
function unquote(arg: string | undefined): string | undefined {
  if (!arg) return undefined
  const match = arg.match(/^"((?:[^"\\]|\\.)*)"$/) ?? arg.match(/^`([^`]*)`$/)
  return match ? match[1] : arg.trim() || undefined
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class GoParser implements Parser {
  extensions = ['.go']

  parseFile(filePath: string, options?: ParseOptions): WorkflowGraph {
    resetIds()

    const source = readFileSync(filePath, 'utf-8')
    const fileName = basename(filePath, '.go')
    const name = options?.name ?? fileName

    const alias = findPackageAlias(source)
    const handler = extractHandlerBody(source, alias)
    if (!handler) {
      throw new Error(`No ${alias}.Start() entry point found in ${filePath}`)
    }

    const contextNames = findContextParams(source, alias)
    const helpers = findHelperFunctions(source, alias, handler.name)
    const workflowNodes = extractNodes(
      handler.body,
      contextNames,
      helpers,
      new Set(),
      source,
      handler.offset,
      alias,
    )

    const startNode: WorkflowNode = { id: 'node_start', kind: 'start', label: 'Start' }
    const endNode: WorkflowNode = { id: 'node_end', kind: 'end', label: 'End' }
    const allNodes = [startNode, ...workflowNodes, endNode]
    const edges = buildEdges(allNodes)

    return { name, nodes: allNodes, edges }
  }
}

/** Find durable Context parameter names from `<name> durable.Context` signatures. */
function findContextParams(source: string, alias: string): string[] {
  const names = new Set<string>()
  const pattern = new RegExp(`(\\w+)\\s+(?:\\w+\\.)?${alias}\\.Context\\b`, 'g')
  let match
  while ((match = pattern.exec(source)) !== null) {
    names.add(match[1])
  }
  if (names.size === 0) {
    names.add('ctx')
    names.add('context')
  }
  return [...names]
}
