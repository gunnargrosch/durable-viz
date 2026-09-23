/**
 * Code generation from WorkflowGraph.
 * Produces boilerplate handler code for TypeScript, Python, Java, C#, Rust,
 * and Go.
 */

import type { WorkflowGraph, WorkflowNode } from '../graph.js'

export type CodeGenLanguage = 'typescript' | 'python' | 'java' | 'csharp' | 'rust' | 'go'

export interface CodeGenOptions {
  language: CodeGenLanguage
}

// ---------------------------------------------------------------------------
// Variable name generation
// ---------------------------------------------------------------------------

function varName(label: string, used: Set<string>): string {
  let base = label
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .replace(/^(\d)/, '_$1')
  if (!base) base = 'node'
  let name = base
  let counter = 2
  while (used.has(name)) {
    name = `${base}_${counter++}`
  }
  used.add(name)
  return name
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const IDENT = '  '
const GO_IDENT = '\t'

/** Wrap a block of code in an if/else structure when condition is present. */
interface ConditionRegion {
  condition: WorkflowNode
  thenNodes: WorkflowNode[]
  elseNodes?: WorkflowNode[]
}

function findConditionRegions(graph: WorkflowGraph): Map<string, ConditionRegion> {
  const regions = new Map<string, ConditionRegion>()
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, [])
    adj.get(e.from)!.push(e.to)
  }

  for (const node of graph.nodes) {
    if (node.kind !== 'condition') continue

    const thenCount = node.thenCount ?? 1
    const condIdx = graph.nodes.indexOf(node)
    const thenNodes = graph.nodes.slice(condIdx + 1, condIdx + 1 + thenCount)

    const noEdge = graph.edges.find((e) => e.from === node.id && e.label === 'no')
    let elseNodes: WorkflowNode[] | undefined
    if (noEdge) {
      const noTarget = nodeMap.get(noEdge.to)
      if (noTarget && noTarget.kind !== 'end') {
        const noIdx = graph.nodes.indexOf(noTarget)
        if (noIdx > condIdx + thenCount) {
          const elseReachable = new Set<string>()
          const visited = new Set<string>()
          const stack = [noTarget.id]
          while (stack.length > 0) {
            const id = stack.pop()!
            if (visited.has(id)) continue
            visited.add(id)
            elseReachable.add(id)
            ;(adj.get(id) || []).forEach(nxt => {
              if (!visited.has(nxt)) stack.push(nxt)
            })
          }
          const thenReachable = new Set<string>()
          for (const tn of thenNodes) {
            const s = [tn.id]
            while (s.length > 0) {
              const id = s.pop()!
              if (thenReachable.has(id)) continue
              thenReachable.add(id)
              const nd = nodeMap.get(id)
              if (nd && nd.kind === 'condition') continue
              ;(adj.get(id) || []).forEach(nxt => {
                if (!thenReachable.has(nxt)) s.push(nxt)
              })
            }
          }
          elseNodes = graph.nodes.slice(noIdx)
            .filter((n) => n.kind !== 'end' && elseReachable.has(n.id) && (n.id === noTarget.id || !thenReachable.has(n.id)))
        }
      }
    }

    regions.set(node.id, { condition: node, thenNodes, elseNodes })
  }

  return regions
}

// ---------------------------------------------------------------------------
// TypeScript code generation
// ---------------------------------------------------------------------------

function genTypeScriptNode(
  node: WorkflowNode,
  indent: number,
  graph: WorkflowGraph,
  conditionRegions: Map<string, ConditionRegion>,
  generatedIds: Set<string>,
  usedNames: Set<string>
): string {
  const pad = IDENT.repeat(indent)
  const vname = varName(node.label, usedNames)
  generatedIds.add(node.id)

  // Check if this node is inside a condition then-branch already handled
  // by skipping: condition regions handle their children.

  switch (node.kind) {
    case 'step': {
      let sem = ''
      if (node.stepSemantics === 'AtMostOncePerRetry') sem = ', { semantics: StepSemantics.AT_MOST_ONCE_PER_RETRY }'
      return `${pad}const ${vname} = await context.step('${node.label}', async (stepCtx) => {\n${pad}${IDENT}// TODO: implement ${node.label}\n${pad}${IDENT}return { done: true };\n${pad}}${sem});`
    }

    case 'invoke': {
      const funcRef = node.target ?? 'MyFunction'
      let tenant = ''
      if (node.tenantId) tenant = `, { tenantId: '${node.tenantId}' }`
      return `${pad}const ${vname} = await context.invoke('${node.label}', '${funcRef}', {\n${pad}${IDENT}// TODO: input payload\n${pad}}${tenant});`
    }

    case 'wait': {
      return `${pad}await context.wait('${node.label}', { seconds: 1 });`
    }

    case 'waitForCallback': {
      let timeout = ''
      if (node.timeout) timeout = `, { timeout: { ${node.timeout} } }`
      return `${pad}const ${vname} = await context.waitForCallback('${node.label}', async (callbackId, callbackCtx) => {\n${pad}${IDENT}// TODO: notify external system with callbackId\n${pad}}${timeout});`
    }

    case 'createCallback': {
      let timeout = ''
      if (node.timeout) timeout = `, { timeout: { ${node.timeout} } }`
      return `${pad}const ${vname} = await context.createCallback('${node.label}'${timeout});`
    }

    case 'waitForCondition': {
      return `${pad}const ${vname} = await context.waitForCondition('${node.label}', async (state, checkCtx) => {\n${pad}${IDENT}// TODO: poll and update state\n${pad}${IDENT}return { /* updated state */ };\n${pad}}, {\n${pad}${IDENT}initialState: { /* ... */ },\n${pad}${IDENT}waitStrategy: createWaitStrategy({ maxAttempts: 10, initialDelay: { seconds: 5 } })\n${pad}});`
    }

    case 'parallel': {
      if (!node.branches?.length) {
        return `${pad}const ${vname} = await context.parallel('${node.label}', []);`
      }
      const configParts: string[] = []
      if (node.nestingType === 'FLAT') configParts.push('nesting: NestingType.FLAT')
      if (node.completionConfig) configParts.push(`completionConfig: CompletionConfig.${node.completionConfig.replace(/\s+/g, '')}`)
      if (node.maxConcurrency != null) configParts.push(`maxConcurrency: ${node.maxConcurrency}`)
      const opts = configParts.length ? `, { ${configParts.join(', ')} }` : ''

      const branches = node.branches.map((b) => {
        const bLabel = b.nodes.map((bn) => bn.label).join(', ')
        return `${pad}${IDENT}{\n${pad}${IDENT}${IDENT}name: '${b.name}',\n${pad}${IDENT}${IDENT}func: async (branchCtx) => {\n${pad}${IDENT}${IDENT}${IDENT}// TODO: ${bLabel}\n${pad}${IDENT}${IDENT}},\n${pad}${IDENT}}`
      }).join(',\n')

      return `${pad}const ${vname} = await context.parallel('${node.label}', [\n${branches}\n${pad}]${opts});`
    }

    case 'map': {
      if (!node.branches?.length) {
        return `${pad}const ${vname} = await context.map('${node.label}', []);`
      }
      const configParts: string[] = []
      if (node.nestingType === 'FLAT') configParts.push('nesting: NestingType.FLAT')
      if (node.maxConcurrency != null) configParts.push(`maxConcurrency: ${node.maxConcurrency}`)
      const opts = configParts.length ? `, { ${configParts.join(', ')} }` : ''

      const branchNames = node.branches.map((b) => `'${b.name}'`).join(', ')
      const branchTodos = node.branches.map((b) => {
        const bLabel = (b.nodes[0]?.label) || b.name
        return `${pad}${IDENT}// TODO: process ${bLabel}`
      }).join('\n')

      return `${pad}const ${vname} = await context.map('${node.label}', [${branchNames}], async (childCtx, item, idx, items) => {\n${branchTodos}\n${pad}}${opts});`
    }

    case 'withRetry': {
      let opts = ''
      if (node.retryStrategy) opts += `, { retryStrategy: ${node.retryStrategy} }`
      return `${pad}const ${vname} = await context.step('${node.label}', async (stepCtx) => {\n${pad}${IDENT}// TODO: implement ${node.label} with retry\n${pad}${IDENT}return { done: true };\n${pad}}, { retryStrategy: createRetryStrategy({ maxAttempts: 3, initialDelay: { seconds: 2 }, backoffRate: 2.0 }) }${opts});`
    }

    case 'runInChildContext': {
      let opts = ''
      if (node.nestingType === 'FLAT') opts += ', { isVirtual: true }'
      return `${pad}const ${vname} = await context.runInChildContext('${node.label}', async (childCtx) => {\n${pad}${IDENT}// TODO: implement ${node.label} in child context\n${pad}}${opts});`
    }

    case 'promiseAll':
      return `${pad}const ${vname} = await context.promise.all('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);`
    case 'promiseAny':
      return `${pad}const ${vname} = await context.promise.any('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);`
    case 'promiseRace':
      return `${pad}const ${vname} = await context.promise.race('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);`
    case 'promiseAllSettled':
      return `${pad}const ${vname} = await context.promise.allSettled('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);`

    case 'condition':
    case 'start':
    case 'end':
      return ''
  }
}

export function generateTypeScript(graph: WorkflowGraph): string {
  const conditionRegions = findConditionRegions(graph)
  const generatedIds = new Set<string>()
  const usedNames = new Set<string>()
  const lines: string[] = []

  const needsWithRetry = graph.nodes.some((n) => n.kind === 'withRetry')
  const needsConfig = graph.nodes.some((n) =>
    n.nestingType === 'FLAT' || n.completionConfig || n.stepSemantics === 'AtMostOncePerRetry'
  )
  const needsWaitStrategy = graph.nodes.some((n) => n.kind === 'waitForCondition')

  const primaryImports = ['withDurableExecution']
  if (needsWithRetry) primaryImports.push('createRetryStrategy')
  if (needsWaitStrategy) primaryImports.push('createWaitStrategy')

  lines.push(`import { ${primaryImports.join(', ')} } from '@aws/durable-execution-sdk-js';`)
  if (needsConfig) {
    lines.push(`import { NestingType, CompletionConfig, StepSemantics } from '@aws/durable-execution-sdk-js';`)
  }

  if (needsConfig && !needsWithRetry && !needsWaitStrategy) {
    // already imported above
  }

  lines.push('')
  lines.push(`export const handler = withDurableExecution(async (event, context) => {`)

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  function emitCondition(node: WorkflowNode, indent: number) {
    const region = conditionRegions.get(node.id)
    if (!region) return
    generatedIds.add(node.id)
    const pad = IDENT.repeat(indent)

    lines.push(`${pad}if (${node.condition ?? node.label}) {`)

    for (const tn of region.thenNodes) {
      if (tn.kind === 'start' || tn.kind === 'end') continue
      if (tn.kind === 'condition') {
        emitCondition(tn, indent + 1)
      } else {
        lines.push(genTypeScriptNode(tn, indent + 1, graph, conditionRegions, generatedIds, usedNames))
      }
    }

    lines.push(`${pad}}`)

    if (region.elseNodes && region.elseNodes.length > 0) {
      lines.push(`${pad}else {`)
      for (const en of region.elseNodes) {
        if (en.kind === 'start' || en.kind === 'end') continue
        if (en.kind === 'condition') {
          emitCondition(en, indent + 1)
        } else {
          lines.push(genTypeScriptNode(en, indent + 1, graph, conditionRegions, generatedIds, usedNames))
        }
      }
      lines.push(`${pad}}`)
    }
  }

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      emitCondition(node, 1)
      lines.push('')
      i += (node.thenCount ?? 1) + 1
      continue
    }

    if (node.kind === 'parallel' || node.kind === 'map') {
      lines.push(genTypeScriptNode(node, 1, graph, conditionRegions, generatedIds, usedNames))
      lines.push('')
      i++
      continue
    }

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    const code = genTypeScriptNode(node, 1, graph, conditionRegions, generatedIds, usedNames)
    if (code) {
      lines.push(code)
      lines.push('')
    }
    i++
  }

  lines.push(`${IDENT}return { status: 'completed' };`)
  lines.push('});')
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Python code generation
// ---------------------------------------------------------------------------

export function generatePython(graph: WorkflowGraph): string {
  const conditionRegions = findConditionRegions(graph)
  const generatedIds = new Set<string>()
  const lines: string[] = []

  const needsWait = graph.nodes.some((n) => n.kind === 'wait')
  const needsWaitForCondition = graph.nodes.some((n) => n.kind === 'waitForCondition')
  const needsWithRetry = graph.nodes.some((n) => n.kind === 'withRetry')
  const needsParallel = graph.nodes.some((n) => n.kind === 'parallel' && n.branches?.length)

  const pyTopImports = ['DurableContext', 'durable_execution']
  const pyConfigImports: string[] = []
  const pyWaitsImports: string[] = []
  const pyRetriesImports: string[] = []

  if (needsWait) pyConfigImports.push('Duration')
  if (needsWithRetry) pyRetriesImports.push('create_retry_strategy')
  if (needsWaitForCondition) { pyWaitsImports.push('WaitForConditionConfig'); pyWaitsImports.push('create_wait_strategy') }
  if (needsWithRetry) pyTopImports.push('with_retry')
  if (needsParallel) pyTopImports.push('ParallelBranch')

  lines.push('from aws_durable_execution_sdk_python import (')
  for (let idx = 0; idx < pyTopImports.length; idx++) {
    const comma = idx < pyTopImports.length - 1 ? ',' : ''
    lines.push(`${IDENT}${pyTopImports[idx]}${comma}`)
  }
  lines.push(')')
  if (pyConfigImports.length > 0) {
    lines.push(`from aws_durable_execution_sdk_python.config import ${pyConfigImports.join(', ')}`)
  }
  if (pyWaitsImports.length > 0) {
    lines.push(`from aws_durable_execution_sdk_python.waits import ${pyWaitsImports.join(', ')}`)
  }
  if (pyRetriesImports.length > 0) {
    lines.push(`from aws_durable_execution_sdk_python.retries import ${pyRetriesImports.join(', ')}`)
  }
  lines.push('')
  lines.push('@durable_execution')
  lines.push(`def handler(event: dict, context: DurableContext) -> dict:`)

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  function emitCondition(node: WorkflowNode, indent: number) {
    const region = conditionRegions.get(node.id)
    if (!region) return
    generatedIds.add(node.id)
    const pad = IDENT.repeat(indent)

    lines.push(`${pad}if ${node.condition ?? node.label}:`)

    for (const tn of region.thenNodes) {
      if (tn.kind === 'start' || tn.kind === 'end') continue
      if (tn.kind === 'condition') {
        emitCondition(tn, indent + 1)
      } else {
        lines.push(genPythonNode(tn, indent + 1, generatedIds))
      }
    }

    if (region.elseNodes && region.elseNodes.length > 0) {
      lines.push(`${pad}else:`)
      for (const en of region.elseNodes) {
        if (en.kind === 'start' || en.kind === 'end') continue
        if (en.kind === 'condition') {
          emitCondition(en, indent + 1)
        } else {
          lines.push(genPythonNode(en, indent + 1, generatedIds))
        }
      }
    }
  }

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      emitCondition(node, 1)
      lines.push('')
      i += (node.thenCount ?? 1) + 1
      continue
    }

    if (!generatedIds.has(node.id)) {
      const code = genPythonNode(node, 1, generatedIds)
      if (code) lines.push(code)
      lines.push('')
    }
    i++
  }

  lines.push(`${IDENT}return {"status": "completed"}`)
  lines.push('')

  return lines.join('\n')
}

function genPythonNode(
  node: WorkflowNode,
  indent: number,
  generatedIds: Set<string>
): string {
  const pad = IDENT.repeat(indent)
  generatedIds.add(node.id)

  switch (node.kind) {
    case 'step':
      return `${pad}context.step(func=lambda step_ctx: None, name="${node.label}")  # TODO: implement ${node.label}\n`
    case 'invoke':
      return `${pad}context.invoke(function_name="${node.target ?? 'MyFunction'}", payload={}, name="${node.label}")  # TODO: input payload\n`
    case 'wait':
      return `${pad}context.wait(duration=Duration.from_seconds(30), name="${node.label}")\n`
    case 'waitForCallback':
      return `${pad}context.wait_for_callback(submitter=lambda callback_id, callback_ctx: None, name="${node.label}")  # TODO: notify external system\n`
    case 'createCallback':
      return `${pad}context.create_callback(name="${node.label}")\n`
    case 'waitForCondition':
      return `${pad}context.wait_for_condition(check=lambda state, check_ctx: state, config=WaitForConditionConfig(initial_state={}, wait_strategy=create_wait_strategy(max_attempts=10, initial_delay=Duration.from_seconds(5))), name="${node.label}")\n`
    case 'parallel':
      if (!node.branches?.length) return `${pad}context.parallel(functions=[], name="${node.label}")\n`
      return `${pad}context.parallel(functions=[${node.branches.map((b) => `ParallelBranch(func=lambda ctx: None, name="${b.name}")`).join(', ')}], name="${node.label}")\n`
    case 'map':
      return `${pad}context.map(inputs=[], func=lambda child_ctx, item, idx, items: None, name="${node.label}")  # TODO: map items\n`
    case 'withRetry':
      return `${pad}with_retry(context=context, func=lambda retry_ctx, attempt: None, name="${node.label}")  # TODO: implement with retry\n`
    case 'runInChildContext':
      return `${pad}context.run_in_child_context(func=lambda child_ctx: None, name="${node.label}")  # TODO: implement in child context\n`
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Java code generation
// ---------------------------------------------------------------------------

export function generateJava(graph: WorkflowGraph): string {
  const conditionRegions = findConditionRegions(graph)
  const generatedIds = new Set<string>()
  const usedNames = new Set<string>()
  const className = toPascalCase(graph.name) || 'WorkflowHandler'
  const lines: string[] = []

  const jneedsWait = graph.nodes.some((n) => n.kind === 'wait')
  const jneedsWaitForCondition = graph.nodes.some((n) => n.kind === 'waitForCondition')

  lines.push('import software.amazon.lambda.durable.DurableHandler;')
  lines.push('import software.amazon.lambda.durable.DurableContext;')
  if (jneedsWait) lines.push('import software.amazon.lambda.durable.Duration;')
  if (jneedsWaitForCondition) lines.push('import software.amazon.lambda.durable.WaitForConditionConfig;')
  lines.push('')
  lines.push(`public class ${className} extends DurableHandler<Object, Object> {`)
  lines.push('')
  lines.push(`${IDENT}@Override`)
  lines.push(`${IDENT}protected Object handleRequest(Object input, DurableContext ctx) {`)

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  function emitCondition(node: WorkflowNode, indent: number) {
    const region = conditionRegions.get(node.id)
    if (!region) return
    generatedIds.add(node.id)
    const pad = IDENT.repeat(indent)

    lines.push(`${pad}if (${node.condition ?? node.label}) {`)

    for (const tn of region.thenNodes) {
      if (tn.kind === 'start' || tn.kind === 'end') continue
      if (tn.kind === 'condition') {
        emitCondition(tn, indent + 1)
      } else {
        lines.push(genJavaNode(tn, indent + 1, generatedIds, usedNames))
      }
    }

    lines.push(`${pad}}`)

    if (region.elseNodes && region.elseNodes.length > 0) {
      lines.push(`${pad}else {`)
      for (const en of region.elseNodes) {
        if (en.kind === 'start' || en.kind === 'end') continue
        if (en.kind === 'condition') {
          emitCondition(en, indent + 1)
        } else {
          lines.push(genJavaNode(en, indent + 1, generatedIds, usedNames))
        }
      }
      lines.push(`${pad}}`)
    }
  }

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      emitCondition(node, 2)
      lines.push('')
      i += (node.thenCount ?? 1) + 1
      continue
    }

    if (!generatedIds.has(node.id)) {
      const code = genJavaNode(node, 2, generatedIds, usedNames)
      if (code) lines.push(code)
      lines.push('')
    }
    i++
  }

  lines.push(`${IDENT.repeat(2)}return null;`)
  lines.push(`${IDENT}}`)
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function genJavaNode(
  node: WorkflowNode,
  indent: number,
  generatedIds: Set<string>,
  usedNames: Set<string>
): string {
  const pad = IDENT.repeat(indent)
  const vname = varName(node.label, usedNames)
  generatedIds.add(node.id)

  switch (node.kind) {
    case 'step':
      return `${pad}var ${vname} = ctx.step("${node.label}", Object.class, stepCtx -> {\n${pad}${IDENT}// TODO: implement ${node.label}\n${pad}${IDENT}return null;\n${pad}});`
    case 'invoke':
      return `${pad}var ${vname} = ctx.invoke("${node.label}", "${node.target ?? 'MyFunction'}", Object.class, input -> {\n${pad}${IDENT}// TODO: input payload\n${pad}${IDENT}return null;\n${pad}});`
    case 'wait':
      return `${pad}ctx.wait("${node.label}", Duration.ofSeconds(30));`
    case 'waitForCallback':
      return `${pad}var ${vname} = ctx.waitForCallback("${node.label}", callbackId -> {\n${pad}${IDENT}// TODO: notify external system with callbackId\n${pad}});`
    case 'createCallback':
      return `${pad}var ${vname} = ctx.createCallback("${node.label}");`
    case 'waitForCondition':
      return `${pad}var ${vname} = ctx.waitForCondition("${node.label}", state -> {\n${pad}${IDENT}// TODO: poll and update state\n${pad}${IDENT}return state;\n${pad}}, WaitForConditionConfig.builder()\n${pad}${IDENT}.initialState(/* ... */)\n${pad}${IDENT}.maxAttempts(10)\n${pad}${IDENT}.build());`
    case 'parallel':
      if (!node.branches?.length) return `${pad}var ${vname} = ctx.parallel("${node.label}");\n${pad}${vname}.get();`
      return `${pad}var ${vname} = ctx.parallel("${node.label}");\n${node.branches.map((b) => `${pad}${vname}.branch("${b.name}", Object.class, branchCtx -> {\n${pad}${IDENT}// TODO: implement ${b.name}\n${pad}${IDENT}return null;\n${pad}});`).join('\n')}\n${pad}${vname}.get();`
    case 'map':
      return `${pad}var ${vname} = ctx.map("${node.label}", items, Object.class, (item, mapCtx) -> {\n${pad}${IDENT}// TODO: process item\n${pad}${IDENT}return null;\n${pad}});`
    case 'withRetry':
      return `${pad}var ${vname} = ctx.withRetry("${node.label}", (attempt, retryCtx) -> {\n${pad}${IDENT}// TODO: implement ${node.label} with retry\n${pad}${IDENT}return null;\n${pad}});`
    case 'runInChildContext':
      return `${pad}var ${vname} = ctx.runInChildContext("${node.label}", childCtx -> {\n${pad}${IDENT}// TODO: implement ${node.label} in child context\n${pad}${IDENT}return null;\n${pad}});`
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// C# (.NET) code generation
// ---------------------------------------------------------------------------

export function generateCSharp(graph: WorkflowGraph): string {
  const conditionRegions = findConditionRegions(graph)
  const generatedIds = new Set<string>()
  const usedNames = new Set<string>()
  const className = toPascalCase(graph.name) || 'WorkflowHandler'
  const lines: string[] = []

  lines.push('using Amazon.Lambda.Core;')
  lines.push('using Amazon.Lambda.DurableExecution;')
  lines.push('using Amazon.Lambda.RuntimeSupport;')
  lines.push('using Amazon.Lambda.Serialization.SystemTextJson;')
  lines.push('')
  lines.push(`namespace ${className};`)
  lines.push('')
  lines.push('public class Function')
  lines.push('{')
  lines.push(`${IDENT}public static async Task Main(string[] args)`)
  lines.push(`${IDENT}{`)
  lines.push(`${IDENT}${IDENT}var handler = new Function();`)
  lines.push(`${IDENT}${IDENT}var serializer = new DefaultLambdaJsonSerializer();`)
  lines.push(`${IDENT}${IDENT}using var handlerWrapper = HandlerWrapper.GetHandlerWrapper<DurableExecutionInvocationInput, DurableExecutionInvocationOutput>(handler.Handler, serializer);`)
  lines.push(`${IDENT}${IDENT}using var bootstrap = new LambdaBootstrap(handlerWrapper);`)
  lines.push(`${IDENT}${IDENT}await bootstrap.RunAsync();`)
  lines.push(`${IDENT}}`)
  lines.push('')
  lines.push(`${IDENT}public Task<DurableExecutionInvocationOutput> Handler(`)
  lines.push(`${IDENT}${IDENT}DurableExecutionInvocationInput input, ILambdaContext context)`)
  lines.push(`${IDENT}${IDENT}=> DurableFunction.WrapAsync<object, object>(Workflow, input, context);`)
  lines.push('')
  lines.push(`${IDENT}private async Task<object> Workflow(object input, IDurableContext ctx)`)
  lines.push(`${IDENT}{`)

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  function emitCondition(node: WorkflowNode, indent: number) {
    const region = conditionRegions.get(node.id)
    if (!region) return
    generatedIds.add(node.id)
    const pad = IDENT.repeat(indent)

    lines.push(`${pad}if (${node.condition ?? node.label})`)
    lines.push(`${pad}{`)

    for (const tn of region.thenNodes) {
      if (tn.kind === 'start' || tn.kind === 'end') continue
      if (tn.kind === 'condition') {
        emitCondition(tn, indent + 1)
      } else {
        lines.push(genCSharpNode(tn, indent + 1, generatedIds, usedNames))
      }
    }

    lines.push(`${pad}}`)

    if (region.elseNodes && region.elseNodes.length > 0) {
      lines.push(`${pad}else`)
      lines.push(`${pad}{`)
      for (const en of region.elseNodes) {
        if (en.kind === 'start' || en.kind === 'end') continue
        if (en.kind === 'condition') {
          emitCondition(en, indent + 1)
        } else {
          lines.push(genCSharpNode(en, indent + 1, generatedIds, usedNames))
        }
      }
      lines.push(`${pad}}`)
    }
  }

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      emitCondition(node, 2)
      lines.push('')
      i += (node.thenCount ?? 1) + 1
      continue
    }

    if (!generatedIds.has(node.id)) {
      const code = genCSharpNode(node, 2, generatedIds, usedNames)
      if (code) lines.push(code)
      lines.push('')
    }
    i++
  }

  lines.push(`${IDENT.repeat(2)}return null;`)
  lines.push(`${IDENT}}`)
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function genCSharpNode(
  node: WorkflowNode,
  indent: number,
  generatedIds: Set<string>,
  usedNames: Set<string>
): string {
  const pad = IDENT.repeat(indent)
  const vname = varName(node.label, usedNames)
  generatedIds.add(node.id)

  switch (node.kind) {
    case 'step': {
      const sem = node.stepSemantics === 'AtMostOncePerRetry'
        ? `,\n${pad}${IDENT}config: new StepConfig { Semantics = StepSemantics.AtMostOncePerRetry })`
        : ')'
      return `${pad}var ${vname} = await ctx.StepAsync(\n${pad}${IDENT}async (_, _) => {\n${pad}${IDENT}${IDENT}// TODO: implement ${node.label}\n${pad}${IDENT}${IDENT}await Task.CompletedTask;\n${pad}${IDENT}${IDENT}return null;\n${pad}${IDENT}},\n${pad}${IDENT}name: "${node.label}"${sem};`
    }
    case 'invoke': {
      const tenant = node.tenantId
        ? `,\n${pad}${IDENT}config: new InvokeConfig { TenantId = "${node.tenantId}" })`
        : ')'
      return `${pad}var ${vname} = await ctx.InvokeAsync<object, object>(\n${pad}${IDENT}functionName: "${node.target ?? 'MyFunction'}",\n${pad}${IDENT}payload: new { },\n${pad}${IDENT}name: "${node.label}"${tenant};`
    }
    case 'wait':
      return `${pad}await ctx.WaitAsync(\n${pad}${IDENT}TimeSpan.FromSeconds(30),\n${pad}${IDENT}name: "${node.label}");`
    case 'waitForCallback':
      return `${pad}var ${vname} = await ctx.WaitForCallbackAsync<object>(\n${pad}${IDENT}submitter: async (callbackId, cbCtx, _) => {\n${pad}${IDENT}${IDENT}// TODO: notify external system with callbackId\n${pad}${IDENT}${IDENT}await Task.CompletedTask;\n${pad}${IDENT}},\n${pad}${IDENT}name: "${node.label}");`
    case 'createCallback':
      return `${pad}var ${vname} = await ctx.CreateCallbackAsync<object>(\n${pad}${IDENT}name: "${node.label}");`
    case 'waitForCondition':
      return `${pad}var ${vname} = await ctx.WaitForConditionAsync<object>(\n${pad}${IDENT}check: async (state, ctx, _) => {\n${pad}${IDENT}${IDENT}// TODO: poll and update state\n${pad}${IDENT}${IDENT}await Task.CompletedTask;\n${pad}${IDENT}${IDENT}return state;\n${pad}${IDENT}},\n${pad}${IDENT}config: new WaitForConditionConfig<object>\n${pad}${IDENT}{\n${pad}${IDENT}${IDENT}InitialState = new { },\n${pad}${IDENT}${IDENT}WaitStrategy = WaitStrategy.Fixed<object>(\n${pad}${IDENT}${IDENT}${IDENT}delay: TimeSpan.FromSeconds(5),\n${pad}${IDENT}${IDENT}${IDENT}maxAttempts: 10,\n${pad}${IDENT}${IDENT}${IDENT}isDone: s => false)\n${pad}${IDENT}},\n${pad}${IDENT}name: "${node.label}");`
    case 'parallel': {
      const config = node.maxConcurrency != null
        ? `,\n${pad}${IDENT}config: new ParallelConfig { MaxConcurrency = ${node.maxConcurrency} })`
        : ')'
      if (!node.branches?.length) {
        return `${pad}var ${vname} = await ctx.ParallelAsync<object>(\n${pad}${IDENT}Array.Empty<Func<IDurableContext, CancellationToken, Task<object>>>(),\n${pad}${IDENT}name: "${node.label}"${config};`
      }
      return `${pad}var ${vname} = await ctx.ParallelAsync(\n${pad}${IDENT}new[]\n${pad}${IDENT}{\n${node.branches.map((b) => `${pad}${IDENT}${IDENT}new DurableBranch<object>("${b.name}", async (_, _) => {\n${pad}${IDENT}${IDENT}${IDENT}// TODO: implement ${b.name}\n${pad}${IDENT}${IDENT}${IDENT}await Task.CompletedTask;\n${pad}${IDENT}${IDENT}${IDENT}return null;\n${pad}${IDENT}${IDENT}})`).join(',\n')}\n${pad}${IDENT}},\n${pad}${IDENT}name: "${node.label}"${config};`
    }
    case 'map': {
      const config = node.maxConcurrency != null
        ? `,\n${pad}${IDENT}config: new MapConfig<object> { MaxConcurrency = ${node.maxConcurrency} })`
        : ')'
      return `${pad}var ${vname} = await ctx.MapAsync<object, object>(\n${pad}${IDENT}Array.Empty<object>(),\n${pad}${IDENT}async (childCtx, item, idx, items, _) => {\n${pad}${IDENT}${IDENT}// TODO: process item\n${pad}${IDENT}${IDENT}await Task.CompletedTask;\n${pad}${IDENT}${IDENT}return null;\n${pad}${IDENT}},\n${pad}${IDENT}name: "${node.label}"${config};`
    }
    case 'runInChildContext':
      return `${pad}var ${vname} = await ctx.RunInChildContextAsync<object>(\n${pad}${IDENT}async (childCtx, _) => {\n${pad}${IDENT}${IDENT}// TODO: implement ${node.label} in child context\n${pad}${IDENT}${IDENT}await Task.CompletedTask;\n${pad}${IDENT}${IDENT}return null;\n${pad}${IDENT}},\n${pad}${IDENT}name: "${node.label}");`
    case 'withRetry':
      return `${pad}// withRetry: wrap in a StepAsync with StepConfig.RetryStrategy (no standalone WithRetryAsync in .NET SDK)\n${pad}var ${vname} = await ctx.StepAsync(\n${pad}${IDENT}async (_, _) => {\n${pad}${IDENT}${IDENT}// TODO: implement ${node.label}\n${pad}${IDENT}${IDENT}await Task.CompletedTask;\n${pad}${IDENT}${IDENT}return null;\n${pad}${IDENT}},\n${pad}${IDENT}name: "${node.label}",\n${pad}${IDENT}config: new StepConfig { RetryStrategy = RetryStrategy.ExponentialBackoff(maxAttempts: 3) });`
    default:
      return ''
  }
}

// ---------------------------------------------------------------------------
// Rust code generation
// ---------------------------------------------------------------------------

export function generateRust(graph: WorkflowGraph): string {
  const conditionRegions = findConditionRegions(graph)
  const generatedIds = new Set<string>()
  const usedNames = new Set<string>()
  const lines: string[] = []

  const needsDuration = graph.nodes.some((n) => n.kind === 'wait' || n.kind === 'waitForCondition')
  const needsBranch = graph.nodes.some((n) => n.kind === 'parallel' && n.branches?.length)
  const needsNesting = graph.nodes.some((n) => n.nestingType === 'FLAT')
  const needsCompletion = graph.nodes.some((n) => n.completionConfig)
  const needsSemantics = graph.nodes.some((n) => n.stepSemantics === 'AtMostOncePerRetry')

  lines.push('use aws_durable_execution_sdk as durable;')
  if (needsDuration) lines.push('use std::time::Duration;')
  if (needsBranch) lines.push('use durable::Branch;')
  if (needsNesting) lines.push('use durable::builders::map_parallel::NestingMode;')
  if (needsCompletion) lines.push('use durable::builders::map_parallel::CompletionConfig;')
  if (needsSemantics) lines.push('use durable::StepSemantics;')
  lines.push('')
  lines.push('async fn handler(')
  lines.push(`${IDENT}_event: serde_json::Value,`)
  lines.push(`${IDENT}ctx: durable::DurableContext,`)
  lines.push(') -> Result<serde_json::Value, durable::BoxError> {')

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  function emitCondition(node: WorkflowNode, indent: number) {
    const region = conditionRegions.get(node.id)
    if (!region) return
    generatedIds.add(node.id)
    const pad = IDENT.repeat(indent)

    lines.push(`${pad}if ${node.condition ?? node.label} {`)

    for (const tn of region.thenNodes) {
      if (tn.kind === 'start' || tn.kind === 'end') continue
      if (tn.kind === 'condition') {
        emitCondition(tn, indent + 1)
      } else {
        lines.push(genRustNode(tn, indent + 1, generatedIds, usedNames))
      }
    }

    lines.push(`${pad}}`)

    if (region.elseNodes && region.elseNodes.length > 0) {
      lines.push(`${pad}else {`)
      for (const en of region.elseNodes) {
        if (en.kind === 'start' || en.kind === 'end') continue
        if (en.kind === 'condition') {
          emitCondition(en, indent + 1)
        } else {
          lines.push(genRustNode(en, indent + 1, generatedIds, usedNames))
        }
      }
      lines.push(`${pad}}`)
    }
  }

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      emitCondition(node, 1)
      lines.push('')
      i += (node.thenCount ?? 1) + 1
      continue
    }

    if (!generatedIds.has(node.id)) {
      const code = genRustNode(node, 1, generatedIds, usedNames)
      if (code) lines.push(code)
      lines.push('')
    }
    i++
  }

  lines.push(`${IDENT}Ok(serde_json::json!({ "status": "completed" }))`)
  lines.push('}')
  lines.push('')
  lines.push('#[tokio::main]')
  lines.push('async fn main() -> Result<(), lambda_runtime::Error> {')
  lines.push(`${IDENT}lambda_runtime::tracing::init_default_subscriber();`)
  lines.push(`${IDENT}durable::run(handler).await`)
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function genRustNode(
  node: WorkflowNode,
  indent: number,
  generatedIds: Set<string>,
  usedNames: Set<string>
): string {
  const pad = IDENT.repeat(indent)
  const vname = varName(node.label, usedNames)
  generatedIds.add(node.id)

  const chain = (parts: string[]): string => parts.filter(Boolean).join('')

  switch (node.kind) {
    case 'step': {
      const sem = node.stepSemantics === 'AtMostOncePerRetry'
        ? '.semantics(durable::StepSemantics::AtMostOncePerRetry)'
        : ''
      return `${pad}let ${vname} = ctx.step(|_| async { Ok(()) })${sem}.name("${node.label}").await?;`
    }
    case 'invoke': {
      const funcRef = node.target ?? 'MyFunction'
      const tenant = node.tenantId ? `.tenant_id("${node.tenantId}")` : ''
      return `${pad}let ${vname} = ctx.invoke::<serde_json::Value, _>("${funcRef}", serde_json::json!({}))${tenant}.name("${node.label}").await?;`
    }
    case 'wait':
      return `${pad}ctx.wait(Duration::from_secs(1)).name("${node.label}").await?;`
    case 'waitForCallback':
      return `${pad}let ${vname} = ctx.wait_for_callback::<serde_json::Value, _, _>(|_, _| async {\n${pad}${IDENT}// TODO: notify external system with callback id\n${pad}${IDENT}Ok(())\n${pad}}).name("${node.label}").await?;`
    case 'createCallback':
      return `${pad}let ${vname} = ctx.create_callback::<serde_json::Value>().name("${node.label}").await?.result().await?;`
    case 'waitForCondition':
      return `${pad}let ${vname} = ctx.wait_for_condition(|_ctx, state: i32| async move { Ok(state + 1) }, 0)\n${pad}${IDENT}.wait_strategy_fn(|state, _attempt| {\n${pad}${IDENT}${IDENT}if state >= 1 { durable::builders::wait_for_condition::WaitDecision::complete() } else { durable::builders::wait_for_condition::WaitDecision::continue_with(Duration::from_secs(1)) }\n${pad}${IDENT}})\n${pad}${IDENT}.name("${node.label}").await?;`
    case 'parallel': {
      const modifiers = chain([
        node.nestingType === 'FLAT' ? '.nesting(NestingMode::Flat)' : '',
        node.completionConfig ? '.completion(CompletionConfig::builder().build()?)' : '',
        node.maxConcurrency != null ? `.max_concurrency(${node.maxConcurrency})` : '',
      ])
      if (!node.branches?.length) {
        return `${pad}let ${vname} = ctx.parallel(Vec::<durable::Branch<serde_json::Value>>::new())${modifiers}.name("${node.label}").await?;`
      }
      const branchCode = node.branches.map((b) =>
        `${pad}${IDENT}Branch::new("${b.name}", |_child| async move { Ok(()) })`
      ).join(',\n')
      return `${pad}let ${vname} = ctx.parallel(vec![\n${branchCode}\n${pad}])${modifiers}.name("${node.label}").await?;`
    }
    case 'map': {
      const modifiers = chain([
        node.nestingType === 'FLAT' ? '.nesting(NestingMode::Flat)' : '',
        node.completionConfig ? '.completion(CompletionConfig::builder().build()?)' : '',
        node.maxConcurrency != null ? `.max_concurrency(${node.maxConcurrency})` : '',
      ])
      return `${pad}let ${vname} = ctx.map(vec![], |_child, _item, _idx| async move { Ok(()) })${modifiers}.name("${node.label}").await?;`
    }
    case 'withRetry':
      return `${pad}let ${vname} = ctx.with_retry(|_ctx| async move { Ok(()) }).name("${node.label}").await?;`
    case 'runInChildContext':
      return `${pad}let ${vname} = ctx.run_in_child_context(|_child| async move { Ok(()) }).name("${node.label}").await?;`
    case 'promiseAll':
      return `${pad}let ${vname} = ctx.try_join_all([\n${pad}${IDENT}// TODO: add operation futures (e.g. ctx.step(...).name("x").future())\n${pad}]).name("${node.label}").await?;`
    case 'promiseAny':
      return `${pad}let ${vname} = ctx.select_ok([\n${pad}${IDENT}// TODO: add operation futures (e.g. ctx.step(...).name("x").future())\n${pad}]).name("${node.label}").await?;`
    case 'promiseRace':
      return `${pad}let ${vname} = ctx.race([\n${pad}${IDENT}// TODO: add operation futures (e.g. ctx.step(...).name("x").future())\n${pad}]).name("${node.label}").await?;`
    case 'promiseAllSettled':
      return `${pad}let ${vname} = ctx.join_all([\n${pad}${IDENT}// TODO: add operation futures (e.g. ctx.step(...).name("x").future())\n${pad}]).name("${node.label}").await?;`
    case 'condition':
    case 'start':
    case 'end':
      return ''
  }
}

// ---------------------------------------------------------------------------
// Go code generation
// ---------------------------------------------------------------------------

/** Build the `durable.WithMaxConcurrency` / `WithCompletion` / `WithNesting` options
 * trailing a Go batch call (Parallel/Map). */
function goBatchOptions(node: WorkflowNode): string {
  const parts: string[] = []
  if (node.nestingType === 'FLAT') parts.push('durable.WithNesting(durable.NestingFlat)')
  if (node.maxConcurrency != null) parts.push(`durable.WithMaxConcurrency(${node.maxConcurrency})`)
  if (node.completionConfig) {
    const fields: string[] = []
    const min = node.completionConfig.match(/minSuccessful:\s*(\d+)/)
    if (min) fields.push(`MinSuccessful: ${min[1]}`)
    const count = node.completionConfig.match(/toleratedFailures:\s*(\d+)/)
    if (count) fields.push(`ToleratedFailureCount: aws.Int(${count[1]})`)
    const pct = node.completionConfig.match(/toleratedPct:\s*(\d+)%?/)
    if (pct) fields.push(`ToleratedFailurePercentage: aws.Int(${pct[1]})`)
    if (fields.length > 0) parts.push(`durable.WithCompletion(durable.CompletionConfig{${fields.join(', ')}})`)
  }
  return parts.map((p) => `, ${p}`).join('')
}

export function generateGo(graph: WorkflowGraph): string {
  const conditionRegions = findConditionRegions(graph)
  const generatedIds = new Set<string>()
  const usedNames = new Set<string>()
  const lines: string[] = []

  const needsTime = graph.nodes.some((n) =>
    n.kind === 'wait' || (n.timeout != null && /time\./.test(n.timeout))
  )
  const needsAws = graph.nodes.some((n) => /tolerated/.test(n.completionConfig ?? ''))

  lines.push('package main')
  lines.push('')
  lines.push('import (')
  lines.push(`${GO_IDENT}"github.com/aws/aws-durable-execution-sdk-go/durable"`)
  if (needsAws) lines.push(`${GO_IDENT}"github.com/aws/aws-sdk-go-v2/aws"`)
  if (needsTime) lines.push(`${GO_IDENT}"time"`)
  lines.push(')')
  lines.push('')
  lines.push('func handler(ctx durable.Context, event any) (any, error) {')

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  function emitCondition(node: WorkflowNode, indent: number) {
    const region = conditionRegions.get(node.id)
    if (!region) return
    generatedIds.add(node.id)
    const pad = GO_IDENT.repeat(indent)

    lines.push(`${pad}if ${node.condition ?? node.label} {`)

    for (const tn of region.thenNodes) {
      if (tn.kind === 'start' || tn.kind === 'end') continue
      if (tn.kind === 'condition') {
        emitCondition(tn, indent + 1)
      } else {
        lines.push(genGoNode(tn, indent + 1, generatedIds, usedNames))
      }
    }

    lines.push(`${pad}}`)

    if (region.elseNodes && region.elseNodes.length > 0) {
      lines.push(`${pad}else {`)
      for (const en of region.elseNodes) {
        if (en.kind === 'start' || en.kind === 'end') continue
        if (en.kind === 'condition') {
          emitCondition(en, indent + 1)
        } else {
          lines.push(genGoNode(en, indent + 1, generatedIds, usedNames))
        }
      }
      lines.push(`${pad}}`)
    }
  }

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      emitCondition(node, 1)
      lines.push('')
      i += (node.thenCount ?? 1) + 1
      continue
    }

    if (!generatedIds.has(node.id)) {
      const code = genGoNode(node, 1, generatedIds, usedNames)
      if (code) lines.push(code)
      lines.push('')
    }
    i++
  }

  lines.push(`${GO_IDENT}return map[string]any{"status": "completed"}, nil`)
  lines.push('}')
  lines.push('')
  lines.push('func main() {')
  lines.push(`${GO_IDENT}durable.Start(handler)`)
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function genGoNode(
  node: WorkflowNode,
  indent: number,
  generatedIds: Set<string>,
  usedNames: Set<string>
): string {
  const pad = GO_IDENT.repeat(indent)
  const vname = varName(node.label, usedNames)
  generatedIds.add(node.id)

  const errCheck = `\n${pad}if err != nil {\n${pad}${GO_IDENT}return nil, err\n${pad}}\n${pad}_ = ${vname}`

  switch (node.kind) {
    case 'step': {
      const opts: string[] = []
      if (node.stepSemantics === 'AtMostOncePerRetry') opts.push('durable.WithSemantics(durable.AtMostOncePerRetry)')
      if (node.retryStrategy) opts.push(`durable.WithRetry(${goRetryStrategy(node.retryStrategy)})`)
      const args = opts.length ? `, ${opts.join(', ')}` : ''
      return `${pad}${vname}, err := durable.Step(ctx, "${node.label}", func(stepCtx durable.StepContext) (any, error) {\n${pad}${GO_IDENT}// TODO: implement ${node.label}\n${pad}${GO_IDENT}return nil, nil\n${pad}}${args})${errCheck}`
    }

    case 'invoke': {
      const tenant = node.tenantId ? `, durable.WithTenantID("${node.tenantId}")` : ''
      return `${pad}${vname}, err := durable.Invoke[any, any](ctx, "${node.label}", "${node.target ?? 'MyFunction'}", nil${tenant})${errCheck}`
    }

    case 'wait': {
      const duration = node.timeout && /time\./.test(node.timeout) ? node.timeout : '30*time.Second'
      return `${pad}if err := durable.Wait(ctx, "${node.label}", ${duration}); err != nil {\n${pad}${GO_IDENT}return nil, err\n${pad}}`
    }

    case 'waitForCallback': {
      const timeout = node.timeout && /time\./.test(node.timeout) ? `, durable.WithCallbackTimeout(${node.timeout})` : ''
      return `${pad}${vname}, err := durable.WaitForCallback[any](ctx, "${node.label}", func(stepCtx durable.StepContext, callbackID string) error {\n${pad}${GO_IDENT}// TODO: notify external system with callbackID\n${pad}${GO_IDENT}return nil\n${pad}}${timeout})${errCheck}`
    }

    case 'createCallback': {
      const timeout = node.timeout && /time\./.test(node.timeout) ? `, durable.WithCallbackTimeout(${node.timeout})` : ''
      return `${pad}${vname}, err := durable.CreateCallback[any](ctx, "${node.label}"${timeout})${errCheck}`
    }

    case 'waitForCondition':
      return `${pad}${vname}, err := durable.WaitForCondition[any](ctx, "${node.label}", func(stepCtx durable.StepContext, state any) (any, error) {\n${pad}${GO_IDENT}// TODO: poll and update state\n${pad}${GO_IDENT}return state, nil\n${pad}}, durable.ConditionConfig[any]{})${errCheck}`

    case 'parallel': {
      const opts = goBatchOptions(node)
      if (!node.branches?.length) {
        return `${pad}${vname}, err := durable.Parallel[any](ctx, "${node.label}", []durable.Branch[any]{}${opts})${errCheck}`
      }
      const branches = node.branches.map((b) =>
        `${pad}${GO_IDENT}{Name: "${b.name}", Func: func(ctx durable.Context) (any, error) {\n${pad}${GO_IDENT}${GO_IDENT}// TODO: implement ${b.name}\n${pad}${GO_IDENT}${GO_IDENT}return nil, nil\n${pad}${GO_IDENT}}},`
      ).join('\n')
      return `${pad}${vname}, err := durable.Parallel[any](ctx, "${node.label}", []durable.Branch[any]{\n${branches}\n${pad}}${opts})${errCheck}`
    }

    case 'map': {
      const opts = goBatchOptions(node)
      return `${pad}${vname}, err := durable.Map[any, any](ctx, "${node.label}", []any{}, func(ctx durable.Context, item any, index int) (any, error) {\n${pad}${GO_IDENT}// TODO: process item\n${pad}${GO_IDENT}return nil, nil\n${pad}}${opts})${errCheck}`
    }

    case 'runInChildContext': {
      const opts = node.nestingType === 'FLAT' ? ', durable.WithChildVirtual()' : ''
      return `${pad}${vname}, err := durable.RunInChildContext[any](ctx, "${node.label}", func(child durable.Context) (any, error) {\n${pad}${GO_IDENT}// TODO: implement ${node.label} in child context\n${pad}${GO_IDENT}return nil, nil\n${pad}}${opts})${errCheck}`
    }

    case 'withRetry':
      return `${pad}${vname}, err := durable.Retry[any](ctx, "${node.label}", func(retryCtx durable.Context, attempt int) (any, error) {\n${pad}${GO_IDENT}// TODO: implement ${node.label} with retry\n${pad}${GO_IDENT}return nil, nil\n${pad}}, ${goRetryStrategy(node.retryStrategy)})${errCheck}`

    case 'promiseAll':
      return `${pad}${vname}, err := durable.All[any](ctx, "${node.label}", []*durable.Future[any]{\n${pad}${GO_IDENT}// TODO: add operation futures\n${pad}})${errCheck}`
    case 'promiseAny':
      return `${pad}${vname}, err := durable.Any[any](ctx, "${node.label}", []*durable.Future[any]{\n${pad}${GO_IDENT}// TODO: add operation futures\n${pad}})${errCheck}`
    case 'promiseRace':
      return `${pad}${vname}, err := durable.Race[any](ctx, "${node.label}", []*durable.Future[any]{\n${pad}${GO_IDENT}// TODO: add operation futures\n${pad}})${errCheck}`
    case 'promiseAllSettled':
      return `${pad}${vname}, err := durable.AllSettled[any](ctx, "${node.label}", []*durable.Future[any]{\n${pad}${GO_IDENT}// TODO: add operation futures\n${pad}})${errCheck}`

    case 'condition':
    case 'start':
    case 'end':
      return ''
  }
}

/** Map a parsed strategy name back to Go: known constructors get called, variables pass through. */
function goRetryStrategy(strategy: string | undefined): string {
  if (!strategy) return 'durable.ExponentialBackoff()'
  if (strategy === 'ExponentialBackoff' || strategy === 'NoRetry') return `durable.${strategy}()`
  if (/^[a-z]/.test(strategy)) return strategy
  return 'durable.ExponentialBackoff()'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateCode(graph: WorkflowGraph, options: CodeGenOptions): string {
  switch (options.language) {
    case 'typescript':
      return generateTypeScript(graph)
    case 'python':
      return generatePython(graph)
    case 'java':
      return generateJava(graph)
    case 'csharp':
      return generateCSharp(graph)
    case 'rust':
      return generateRust(graph)
    case 'go':
      return generateGo(graph)
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
}
