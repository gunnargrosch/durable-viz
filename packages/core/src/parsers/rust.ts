/**
 * Rust parser for AWS Lambda Durable Execution SDK (preview).
 *
 * Uses regex-based parsing to find `durable::run(handler)` entry points and
 * extract the fluent builder API. The Rust SDK uses snake_case methods on
 * `DurableContext` terminated by `.await?`, with names set on the builder
 * chain rather than as an argument:
 *
 *   ctx.step(|_| async { Ok(()) }).name("greet").await?
 *   ctx.wait(Duration::from_secs(1)).name("cooldown").await?
 *   ctx.parallel(branches).name("fanout").nesting(NestingMode::Flat).await?
 *
 * Combinators are detected too: join_all, try_join_all, select_ok, race.
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
// Primitive mapping: Rust method name → graph NodeKind
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
  'with_retry': { kind: 'withRetry', idPrefix: 'retry' },
  'join_all': { kind: 'promiseAllSettled', idPrefix: 'allsettled' },
  'try_join_all': { kind: 'promiseAll', idPrefix: 'all' },
  'select_ok': { kind: 'promiseAny', idPrefix: 'any' },
  'race': { kind: 'promiseRace', idPrefix: 'race' },
}

// ---------------------------------------------------------------------------
// Rust-specific parsing
// ---------------------------------------------------------------------------

/** Find the crate alias: `use aws_durable_execution_sdk as durable;`. */
function findCrateAlias(source: string): string {
  const match = source.match(/use\s+aws_durable_execution_sdk\s+as\s+(\w+)\s*;/)
  return match?.[1] ?? 'durable'
}

/** Find DurableContext parameter names from `ctx: durable::DurableContext` signatures. */
function findContextParam(source: string): string[] {
  const names = new Set<string>()
  const paramPattern = /(\w+)\s*:\s*(?:\w+::)?DurableContext/g
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
 * Extract a brace-delimited block starting just after an opening brace.
 */
function extractBraceBlock(source: string, startIdx: number): string {
  let depth = 1
  let i = startIdx
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return source.slice(startIdx, i - 1)
}

/** Find the handler body: either a named fn or an inline closure. */
function extractHandlerBody(
  source: string,
  alias: string,
): { body: string; offset: number } | null {
  const entryPattern = new RegExp(`${alias}::(?:run_with_options|run|wrap)\\s*\\(`)
  const entry = entryPattern.exec(source)
  if (!entry) return null

  const argStart = entry.index + entry[0].length
  const argHead = source.slice(argStart, argStart + 120)

  // Inline closure: run(|event, ctx| async move { ... })
  if (/^\s*\|/.test(argHead)) {
    const closureTail = source.slice(argStart)
    const asyncBlock = closureTail.match(/async(?:\s+move)?\s*\{/)
    if (!asyncBlock || asyncBlock.index == null) return null
    const braceIdx = argStart + asyncBlock.index + asyncBlock[0].length
    const body = extractBraceBlock(source, braceIdx)
    return { body, offset: lineOfSubstring(source, body) }
  }

  // Named function: run(handler) → async fn handler(...) { ... }
  const nameMatch = argHead.match(/^\s*(\w+)\s*[,)]/)
  if (!nameMatch) return null
  const fnName = nameMatch[1]
  const fnPattern = new RegExp(`\\basync\\s+fn\\s+${fnName}\\s*\\([^)]*\\)[^{]*\\{`)
  const fnMatch = fnPattern.exec(source)
  if (!fnMatch) return null

  const body = extractBraceBlock(source, fnMatch.index + fnMatch[0].length)
  return { body, offset: lineOfSubstring(source, body) }
}

/** Compute the 1-based line number of a substring within the full source. */
function lineOfSubstring(source: string, substring: string): number {
  const idx = source.indexOf(substring)
  if (idx === -1) return 0
  return source.slice(0, idx).split('\n').length
}

/**
 * Collect the builder-chain lines from startIdx until the chain terminates.
 *
 * Termination is detected by brace depth, not indentation: the chain's own
 * `.await?`/`.future()`/`.spawn()`/`;` sits at brace depth 0, while nested
 * closures (parallel branches, child contexts, step bodies) push the depth
 * above 0 so their `.await` lines are collected rather than mistaken for the
 * end of the chain.
 */
function collectChain(lines: string[], startIdx: number): string[] {
  const parts: string[] = []
  let depth = 0
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    parts.push(line)

    if (depth === 0) {
      const isTerminal = /^\.await\b/.test(trimmed)
        || /^\.future\b/.test(trimmed)
        || /^\.spawn\b/.test(trimmed)
        || trimmed.endsWith(';')
      if (isTerminal) break
    }

    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
  }
  return parts
}

/**
 * Resolve the node's name from a `.name(...)` on the builder chain.
 *
 * The node's own name is the last `.name(...)` applied before the terminal
 * `.await?`; nested closures inside the method arguments appear earlier in the
 * chain. Resolution layers: string literal, local constant propagation,
 * identifier fallback.
 */
function extractNameArg(chain: string, source: string): string | undefined {
  const strMatches = [...chain.matchAll(/\.name\(\s*"([^"]+)"\s*\)/g)]
  if (strMatches.length > 0) return strMatches[strMatches.length - 1][1]

  const varMatches = [...chain.matchAll(/\.name\(\s*&?\s*(\w+)\s*\)/g)]
  if (varMatches.length > 0) {
    const ident = varMatches[varMatches.length - 1][1]
    const constValue = resolveConstBinding(source, ident)
    return constValue ?? ident
  }
  return undefined
}

/** Resolve `let ident = "literal";` (or `let ident: &str = "literal";`). */
function resolveConstBinding(source: string, ident: string): string | undefined {
  const pattern = new RegExp(`\\blet\\s+${ident}\\s*(?::\\s*&?\\s*str)?\\s*=\\s*"([^"]+)"`)
  return pattern.exec(source)?.[1]
}

interface RustConfigFlags {
  nestingType?: string
  completionConfig?: string
  stepSemantics?: string
  tenantId?: string
  maxConcurrency?: number
  retryStrategy?: string
}

function extractRustConfig(chain: string): RustConfigFlags {
  const flags: RustConfigFlags = {}

  const nesting = chain.match(/\.nesting\(\s*(?:\w+::)*NestingMode::(\w+)/)
  if (nesting) flags.nestingType = nesting[1] === 'Flat' ? 'FLAT' : 'NESTED'

  if (/\.completion\(/.test(chain)) {
    const parts: string[] = []
    const min = chain.match(/\.min_successful\(\s*(\d+)/)
    if (min) parts.push(`minSuccessful:${min[1]}`)
    const count = chain.match(/\.tolerated_failure_count\(\s*(\d+)/)
    if (count) parts.push(`toleratedFailures:${count[1]}`)
    const pct = chain.match(/\.tolerated_failure_percentage\(\s*(\d+)/)
    if (pct) parts.push(`toleratedPct:${pct[1]}%`)
    flags.completionConfig = parts.length > 0 ? parts.join(' ') : 'completion'
  }

  const semantics = chain.match(/\.semantics\(\s*(?:\w+::)*StepSemantics::(\w+)/)
  if (semantics) flags.stepSemantics = semantics[1] === 'AtMostOncePerRetry' ? 'AtMostOncePerRetry' : semantics[1]

  const tenant = chain.match(/\.tenant_id\(\s*"([^"]+)"/)
  if (tenant) flags.tenantId = tenant[1]

  const concurrency = chain.match(/\.max_concurrency\(\s*(\d+)/)
  if (concurrency) flags.maxConcurrency = Number(concurrency[1])

  if (/\.retry_strategy\(/.test(chain)) flags.retryStrategy = 'retry_strategy'

  return flags
}

/** Extract parallel branch names from `Branch::new("name", ...)`. */
function extractRustBranches(lines: string[], startLine: number): WorkflowBranch[] {
  const branches: WorkflowBranch[] = []
  const searchText = lines.slice(startLine, startLine + 40).join('\n')

  const branchPattern = /Branch::new\s*\(\s*"([^"]+)"/g
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

    // if <condition> { ... } → condition node
    const ifMatch = line.match(/^if\s+(.+?)\s*\{/)
    if (ifMatch) {
      const braceIdx = body.indexOf('{', body.indexOf(lines[i])) + 1
      if (braceIdx > 0) {
        const condition = ifMatch[1].trim()
        const ifBody = extractBraceBlock(body, braceIdx)
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
    }

    // Durable primitive calls: ctx.<method>( — rustfmt may split the receiver
    // and method across two lines (`ctx` on one line, `.step(` on the next).
    let matched = false
    for (const method of Object.keys(PRIMITIVES)) {
      if (matched) break
      for (const ctxName of contextNames) {
        const methodIdx = findMethodLine(lines, i, ctxName, method)
        if (methodIdx < 0) continue

        matched = true
        const info = PRIMITIVES[method]
        const chain = collectChain(lines, methodIdx).join('\n')
        const label = extractNameArg(chain, source)
        const config = extractRustConfig(chain)

        const node: WorkflowNode = {
          id: nextId(info.idPrefix),
          kind: info.kind,
          label: label ?? method.replace(/_/g, ' '),
          sourceLine: baseLineOffset + methodIdx,
        }

        if (info.kind === 'invoke') {
          const fnMatch = chain.match(/\.invoke::<[^>]*>\s*\(\s*&?\s*([^,\s]+)/)
            ?? chain.match(/\.invoke\s*\(\s*&?\s*([^,\s]+)/)
          if (fnMatch) node.target = fnMatch[1].replace(/^"|"$/g, '')
          if (config.tenantId) node.tenantId = config.tenantId
        }

        if (info.kind === 'parallel' || info.kind === 'map') {
          node.branches = extractRustBranches(lines, methodIdx)
          if (config.nestingType) node.nestingType = config.nestingType
          if (config.completionConfig) node.completionConfig = config.completionConfig
          if (config.maxConcurrency != null) node.maxConcurrency = config.maxConcurrency
        }

        if (info.kind === 'runInChildContext') {
          if (config.nestingType) node.nestingType = config.nestingType
        }

        if (info.kind === 'step' || info.kind === 'withRetry') {
          if (config.stepSemantics) node.stepSemantics = config.stepSemantics
          if (config.retryStrategy) node.retryStrategy = config.retryStrategy
        }

        nodes.push(node)
        break
      }
    }
  }

  return nodes
}

/**
 * Locate the line index where `ctx.<method>(` starts, handling both the
 * same-line form (`ctx.step(`) and the rustfmt split form (`ctx` ending one
 * line, `.step(` starting the next). Returns -1 when absent.
 */
function findMethodLine(lines: string[], i: number, ctxName: string, method: string): number {
  const line = lines[i].trim()
  // Optional turbofish (::<...>) between the method name and the opening paren.
  const turbofish = `(?:::<[^>]*>)?\\s*\\(`

  if (new RegExp(`${ctxName}\\.${method}${turbofish}`).test(line)) return i

  if (new RegExp(`^\\.${method}${turbofish}`).test(line) && i > 0) {
    const prev = lines[i - 1].trim()
    if (prev.endsWith(ctxName)) return i
  }

  return -1
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class RustParser implements Parser {
  extensions = ['.rs']

  parseFile(filePath: string, options?: ParseOptions): WorkflowGraph {
    resetIds()

    const source = readFileSync(filePath, 'utf-8')
    const fileName = basename(filePath, '.rs')
    const name = options?.name ?? fileName

    const alias = findCrateAlias(source)
    const handler = extractHandlerBody(source, alias)
    if (!handler) {
      throw new Error(`No ${alias}::run() entry point found in ${filePath}`)
    }

    const contextNames = findContextParam(source)
    const workflowNodes = extractNodes(handler.body, contextNames, source, handler.offset)

    const startNode: WorkflowNode = { id: 'node_start', kind: 'start', label: 'Start' }
    const endNode: WorkflowNode = { id: 'node_end', kind: 'end', label: 'End' }
    const allNodes = [startNode, ...workflowNodes, endNode]
    const edges = buildEdges(allNodes)

    return { name, nodes: allNodes, edges }
  }
}
