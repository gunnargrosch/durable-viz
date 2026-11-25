/**
 * OpenTelemetry instrumentation detection and expected span helpers.
 *
 * The OTel plugins emit a Workflow span, one Invocation span per Lambda
 * invocation, and an operation span for each durable primitive. The operation
 * span keeps the operation name, so source names map directly to trace names.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { WorkflowGraph, WorkflowNode, WorkflowOtel } from './graph.js'

const CONTROL_KINDS = new Set<WorkflowNode['kind']>(['start', 'end', 'condition', 'loop'])

/** Labels the parsers use when an operation has no explicit name. */
const FALLBACK_LABELS = new Set([
  'step',
  'invoke',
  'parallel',
  'map',
  'wait',
  'waitForCallback',
  'createCallback',
  'waitForCondition',
  'childContext',
  'withRetry',
  'promise.all',
  'promise.any',
  'promise.race',
  'promise.allSettled',
  'wait for callback',
  'create callback',
  'wait for condition',
  'run in child context',
  'retry',
])

/** Whether the node is a durable operation that produces an OTel span. */
export function isOtelOperation(node: WorkflowNode): boolean {
  return !CONTROL_KINDS.has(node.kind)
}

type OtelView = 'execution' | 'invocation'

interface OtelSignals {
  modes: Set<OtelView>
  environmentVariable?: string
  workflowSpanName?: string
}

const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g
const IGNORED_IDENTIFIERS = new Set([
  'true', 'false', 'null', 'undefined', 'new', 'async', 'await', 'function',
  'const', 'let', 'var', 'return', 'if', 'else', 'process', 'env',
])

function collectTypeScriptSignals(source: string): OtelSignals {
  const modes = new Set<OtelView>()

  if (/createExecutionOtelPluginFactory|ExecutionOtelPluginFactory/.test(source)) {
    modes.add('execution')
  }
  if (/createInvocationOtelPluginFactory|InvocationOtelPluginFactory/.test(source)) {
    modes.add('invocation')
  }

  for (const match of source.matchAll(/createOtelPluginFactory\s*\(([\s\S]*?)\)/g)) {
    if (/mode\s*:\s*['"]invocation['"]/.test(match[1])) modes.add('invocation')
    else modes.add('execution')
  }

  const environmentVariable = source.match(/process\.env(?:\?|)\.([A-Z][A-Z0-9_]*)/)?.[1]
    ?? source.match(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/)?.[1]
    ?? source.match(/\b(DURABLE_EXECUTION_PLUGINS)\b/)?.[1]
  const workflowSpanName = source.match(/workflowSpanName\s*:\s*['"]([^'"]+)['"]/)?.[1]

  return { modes, environmentVariable, workflowSpanName }
}

function mergeSignals(target: OtelSignals, source: OtelSignals): void {
  source.modes.forEach((mode) => target.modes.add(mode))
  target.environmentVariable ??= source.environmentVariable
  target.workflowSpanName ??= source.workflowSpanName
}

function identifiersIn(expression: string): string[] {
  const names = new Set<string>()
  for (const match of expression.matchAll(IDENTIFIER_RE)) {
    if (!IGNORED_IDENTIFIERS.has(match[0])) names.add(match[0])
  }
  return [...names]
}

function importSpecifierFor(source: string, identifier: string): string | undefined {
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = match[1].trim()
    const named = clause.match(/\{([\s\S]*?)\}/)
    if (named) {
      for (const part of named[1].split(',')) {
        const pieces = part.trim().split(/\s+as\s+/)
        const imported = pieces[0]
        const local = pieces[1] ?? imported
        if (local === identifier) return match[2]
      }
    }
    const defaultImport = clause.match(/^([A-Za-z_$][\w$]*)/)?.[1]
    if (defaultImport === identifier) return match[2]
  }
  return undefined
}

function resolveLocalModule(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined

  const base = resolve(dirname(fromFile), specifier)
  const candidates: string[] = []
  if (/\.(?:js|mjs|cjs|jsx)$/.test(base)) {
    const withoutExt = base.replace(/\.(?:js|mjs|cjs|jsx)$/, '')
    candidates.push(`${withoutExt}.ts`, `${withoutExt}.tsx`, base)
  } else {
    candidates.push(
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.cjs`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
      join(base, 'index.js'),
    )
  }
  return candidates.find((candidate) => existsSync(candidate))
}

function followHelper(
  identifier: string,
  handlerSource: string,
  handlerPath: string,
  visited: Set<string>,
): OtelSignals | undefined {
  const specifier = importSpecifierFor(handlerSource, identifier)
  if (!specifier) return undefined

  const helperPath = resolveLocalModule(handlerPath, specifier)
  if (!helperPath || visited.has(helperPath)) return undefined
  visited.add(helperPath)

  let helperSource: string
  try {
    helperSource = readFileSync(helperPath, 'utf-8')
  } catch {
    return undefined
  }
  return collectTypeScriptSignals(helperSource)
}

function lineNumberAt(source: string, index: number | undefined): number | undefined {
  if (index == null) return undefined
  return source.slice(0, index).split('\n').length
}

function buildOtel(signals: OtelSignals, registration: string, sourceLine?: number): WorkflowOtel {
  const modes = [...signals.modes].sort()
  const otel: WorkflowOtel = {
    mode: modes.length === 1 ? modes[0] : 'custom',
    workflowSpanName: signals.workflowSpanName ?? 'Workflow',
    source: 'code',
    registration,
  }
  if (sourceLine != null) otel.sourceLine = sourceLine
  if (modes.length > 1) otel.modes = modes
  if (signals.environmentVariable) otel.environmentVariable = signals.environmentVariable
  return otel
}

/**
 * Detect a code-based OpenTelemetry plugin registration in a TypeScript or
 * JavaScript handler. Relative imports are followed so a helper such as
 * `plugins: loadOtelPlugins()` can report the modes it selects.
 */
export function detectTypeScriptOtel(source: string, filePath?: string): WorkflowOtel | undefined {
  const plugins = source.match(/plugins\s*:\s*(\[[\s\S]*?\]|[A-Za-z_$][\w$]*(?:\.[\w$]+)*\s*\([^)]*\)|[A-Za-z_$][\w$.]*)/)
  if (!plugins) return undefined

  const registration = plugins[1].trim()
  const signals = collectTypeScriptSignals(registration)

  if (signals.modes.size === 0 && filePath) {
    const visited = new Set<string>()
    for (const identifier of identifiersIn(registration)) {
      const helper = followHelper(identifier, source, filePath, visited)
      if (helper) mergeSignals(signals, helper)
    }
  }

  if (signals.modes.size === 0 && !signals.environmentVariable && !/otel/i.test(registration)) {
    return undefined
  }

  return buildOtel(signals, registration, lineNumberAt(source, plugins.index))
}

/** Short label for the OTel badge. */
export function otelModeLabel(otel: WorkflowOtel): string {
  return otel.environmentVariable ? 'env' : otel.mode
}

function collectPythonSignals(source: string): OtelSignals {
  const modes = new Set<OtelView>()

  if (/ExecutionOtelPluginFactory|EXECUTION_OTEL_PLUGIN_FACTORY/.test(source)) {
    modes.add('execution')
  }
  if (/InvocationOtelPluginFactory|INVOCATION_OTEL_PLUGIN_FACTORY/.test(source)) {
    modes.add('invocation')
  }
  for (const match of source.matchAll(/create_otel_plugin_factory\s*\(([\s\S]*?)\)/g)) {
    if (/mode\s*=\s*['"]invocation['"]/.test(match[1])) modes.add('invocation')
    else modes.add('execution')
  }

  const environmentVariable = source.match(/os\.environ\.get\s*\(\s*['"]([A-Z][A-Z0-9_]*)['"]/)?.[1]
    ?? source.match(/os\.environ\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/)?.[1]
    ?? source.match(/os\.getenv\s*\(\s*['"]([A-Z][A-Z0-9_]*)['"]/)?.[1]
    ?? source.match(/\b(DURABLE_EXECUTION_PLUGINS)\b/)?.[1]
  const workflowSpanName = source.match(/workflow_span_name\s*=\s*['"]([^'"]+)['"]/)?.[1]

  return { modes, environmentVariable, workflowSpanName }
}

function pythonImportSpecifierFor(source: string, identifier: string): string | undefined {
  for (const match of source.matchAll(/from\s+([.\w]+)\s+import\s+([^\n]+)/g)) {
    for (const part of match[2].split(',')) {
      const pieces = part.trim().split(/\s+as\s+/)
      const imported = pieces[0]
      const local = pieces[1] ?? imported
      if (local === identifier) return match[1]
    }
  }
  return undefined
}

function resolvePythonModule(fromFile: string, module: string): string | undefined {
  let baseDir = dirname(fromFile)
  let rest = module
  if (module.startsWith('.')) {
    const dots = module.match(/^\.+/)![0].length
    rest = module.slice(dots)
    for (let i = 1; i < dots; i++) baseDir = dirname(baseDir)
  }

  const relative = rest ? rest.replace(/\./g, '/') : ''
  const candidates: string[] = []
  const addCandidates = (base: string) => {
    if (relative) {
      candidates.push(`${base}.py`, join(base, '__init__.py'))
    } else {
      candidates.push(join(base, '__init__.py'))
    }
  }

  if (module.startsWith('.')) {
    addCandidates(resolve(baseDir, relative))
  } else {
    // Absolute imports are not anchored to the handler file. Walk up a few
    // project levels and take the first matching source file.
    for (let i = 0; i < 6; i++) {
      addCandidates(resolve(baseDir, relative))
      const parent = dirname(baseDir)
      if (parent === baseDir) break
      baseDir = parent
    }
  }

  return candidates.find((candidate) => existsSync(candidate))
}

function followPythonHelper(
  identifier: string,
  handlerSource: string,
  handlerPath: string,
  visited: Set<string>,
): OtelSignals | undefined {
  const module = pythonImportSpecifierFor(handlerSource, identifier)
  if (!module) return undefined

  const helperPath = resolvePythonModule(handlerPath, module)
  if (!helperPath || visited.has(helperPath)) return undefined
  visited.add(helperPath)

  let helperSource: string
  try {
    helperSource = readFileSync(helperPath, 'utf-8')
  } catch {
    return undefined
  }
  return collectPythonSignals(helperSource)
}

/**
 * Detect a code-based OpenTelemetry plugin registration in a Python handler.
 * Relative and project-absolute imports are followed for helper functions.
 */
export function detectPythonOtel(source: string, filePath?: string): WorkflowOtel | undefined {
  const plugins = source.match(/plugins\s*=\s*(\[[\s\S]*?\]|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\([^)]*\)|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/)
  if (!plugins) return undefined

  const registration = plugins[1].trim()
  const signals = collectPythonSignals(registration)

  if (signals.modes.size === 0 && filePath) {
    const visited = new Set<string>()
    for (const identifier of identifiersIn(registration)) {
      const helper = followPythonHelper(identifier, source, filePath, visited)
      if (helper) mergeSignals(signals, helper)
    }
  }

  if (signals.modes.size === 0 && !signals.environmentVariable && !/otel/i.test(registration)) {
    return undefined
  }

  return buildOtel(signals, registration, lineNumberAt(source, plugins.index))
}

function collectJavaSignals(source: string): OtelSignals {
  const modes = new Set<OtelView>()

  if (/InvocationOtelPlugin|Mode\.INVOCATION|otel-invocation/.test(source)) {
    modes.add('invocation')
  }
  if (/ExecutionOtelPlugin|Mode\.EXECUTION/.test(source)) {
    modes.add('execution')
  }
  for (const match of source.matchAll(/(?:^|[^A-Za-z])OtelPlugin\.factory\s*\(([^)]*)\)/g)) {
    if (/Mode\.INVOCATION/.test(match[1])) modes.add('invocation')
    else modes.add('execution')
  }

  const environmentVariable = source.match(/System\.getenv\s*\(\s*"([A-Z][A-Z0-9_]*)"\s*\)/)?.[1]
    ?? source.match(/\b(DURABLE_EXECUTION_PLUGINS)\b/)?.[1]
  const workflowSpanName = source.match(/workflowSpanName\s*\(\s*["']([^"']+)["']/)?.[1]

  return { modes, environmentVariable, workflowSpanName }
}

function extractBalanced(source: string, openIndex: number, open: string, close: string): string {
  let depth = 1
  let index = openIndex + 1
  while (index < source.length && depth > 0) {
    if (source[index] === open) depth++
    else if (source[index] === close) depth--
    index++
  }
  return source.slice(openIndex + 1, index - 1)
}

function followJavaHelper(identifier: string, source: string, visited: Set<string>): OtelSignals | undefined {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const method = new RegExp(`\\b${escaped}\\s*\\([^)]*\\)\\s*\\{`).exec(source)
  if (!method || method.index == null) return undefined

  const braceIndex = method.index + method[0].length - 1
  const key = `${identifier}:${braceIndex}`
  if (visited.has(key)) return undefined
  visited.add(key)

  return collectJavaSignals(extractBalanced(source, braceIndex, '{', '}'))
}

function javaSourceRoot(handlerPath: string, source: string): string {
  let root = dirname(handlerPath)
  const packageName = source.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1]
  if (packageName) {
    for (let i = 0; i < packageName.split('.').length; i++) root = dirname(root)
  }
  return root
}

function importedJavaClassFor(
  identifier: string,
  source: string,
): { className: string; method?: string } | undefined {
  for (const match of source.matchAll(/import\s+static\s+([\w.]+)\.(\w+)\s*;/g)) {
    if (match[2] === identifier) return { className: match[1], method: match[2] }
  }
  for (const match of source.matchAll(/import\s+([\w.]+)\s*;/g)) {
    if (match[1].split('.').pop() === identifier) return { className: match[1] }
  }
  return undefined
}

function followJavaImportedHelper(
  identifier: string,
  handlerSource: string,
  handlerPath: string,
  visited: Set<string>,
): OtelSignals | undefined {
  const imported = importedJavaClassFor(identifier, handlerSource)
  if (!imported) return undefined

  const classPath = join(javaSourceRoot(handlerPath, handlerSource), `${imported.className.replace(/\./g, '/')}.java`)
  if (!existsSync(classPath) || visited.has(classPath)) return undefined
  visited.add(classPath)

  let classSource: string
  try {
    classSource = readFileSync(classPath, 'utf-8')
  } catch {
    return undefined
  }

  if (imported.method) {
    const methodSignals = followJavaHelper(imported.method, classSource, visited)
    if (methodSignals) return methodSignals
  }
  return collectJavaSignals(classSource)
}

/**
 * Detect a code-based OpenTelemetry plugin registration in a Java handler.
 * Same-file helper methods and imported helper classes are followed.
 */
export function detectJavaOtel(source: string, filePath?: string): WorkflowOtel | undefined {
  const withPlugins = source.match(/\.withPlugins\s*\(/)
  if (!withPlugins || withPlugins.index == null) return undefined

  const openIndex = withPlugins.index + withPlugins[0].length - 1
  const registration = extractBalanced(source, openIndex, '(', ')').trim()
  const signals = collectJavaSignals(registration)

  if (signals.modes.size === 0) {
    const visited = new Set<string>()
    for (const identifier of identifiersIn(registration)) {
      const helper = followJavaHelper(identifier, source, visited)
        ?? (filePath ? followJavaImportedHelper(identifier, source, filePath, visited) : undefined)
      if (helper) mergeSignals(signals, helper)
    }
  }

  if (signals.modes.size === 0 && !signals.environmentVariable && !/otel/i.test(registration)) {
    return undefined
  }

  return buildOtel(signals, registration || 'withPlugins(...)', lineNumberAt(source, withPlugins.index))
}

function isUnnamed(node: WorkflowNode): boolean {
  return FALLBACK_LABELS.has(node.label)
}

function spanLabel(node: WorkflowNode): string {
  return node.label
}

function appendNode(
  lines: string[],
  node: WorkflowNode,
  indent: number,
  seen: Map<string, number>,
  depth = 0,
): void {
  const pad = '  '.repeat(indent)
  const label = spanLabel(node)
  const occurrences = (seen.get(label) ?? 0) + 1
  seen.set(label, occurrences)

  let suffix = ''
  if (isUnnamed(node)) suffix += '  (unnamed, span uses the operation type)'
  if (occurrences > 1) suffix += '  (duplicate name)'

  lines.push(`${pad}${node.kind} "${label}"${suffix}`)

  if (node.kind === 'step' || node.kind === 'waitForCondition') {
    lines.push(`${pad}  attempt "${label} attempt N"`)
  }

  if (node.branches?.length && depth < 8) {
    for (const branch of node.branches) {
      lines.push(`${pad}  branch "${branch.name}"`)
      for (const child of branch.nodes) {
        if (isOtelOperation(child)) appendNode(lines, child, indent + 2, seen, depth + 1)
      }
    }
  }

  if (node.children?.length && depth < 8) {
    for (const child of node.children) {
      if (isOtelOperation(child)) appendNode(lines, child, indent + 1, seen, depth + 1)
    }
  }
}

/**
 * Render the expected OTel span tree for a parsed workflow. Returns undefined
 * when the handler does not register the plugin in source.
 */
export function renderOtelTree(graph: WorkflowGraph): string | undefined {
  if (!graph.otel) return undefined

  const modeLabel = graph.otel.environmentVariable
    ? `selected by ${graph.otel.environmentVariable}${graph.otel.modes?.length ? ` (${graph.otel.modes.join(' or ')})` : ''}${graph.otel.registration ? ` (${graph.otel.registration})` : ''}`
    : graph.otel.mode === 'custom'
      ? `custom registration${graph.otel.registration ? ` (${graph.otel.registration})` : ''}`
      : `${graph.otel.mode} mode`
  const root = graph.otel.mode === 'invocation'
    ? 'Invocation'
    : graph.otel.mode === 'execution'
      ? `Workflow "${graph.otel.workflowSpanName}"`
      : 'Expected operation spans:'
  const lines: string[] = [
    `OTel plugin: ${modeLabel}`,
    `Workflow span: "${graph.otel.workflowSpanName}"`,
    '',
    root,
  ]

  const seen = new Map<string, number>()
  for (const node of graph.nodes) {
    if (isOtelOperation(node)) appendNode(lines, node, 1, seen)
  }

  const unnamed = graph.nodes.filter((node) => isOtelOperation(node) && isUnnamed(node))
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1)

  if (unnamed.length > 0 || duplicates.length > 0) {
    lines.push('', 'Warnings:')
    if (unnamed.length > 0) {
      lines.push(`${'  '}- ${unnamed.length} operation${unnamed.length === 1 ? '' : 's'} without an explicit name`)
    }
    for (const [label, count] of duplicates) {
      lines.push(`${'  '}- "${label}" appears ${count} times; spans share the same name`)
    }
  }

  return lines.join('\n')
}
