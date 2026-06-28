/**
 * Code generation from WorkflowGraph.
 * Produces boilerplate handler code for TypeScript, Python, and Java.
 */

import type { WorkflowGraph, WorkflowNode, WorkflowBranch } from '../graph.js'

export type CodeGenLanguage = 'typescript' | 'python' | 'java'

export interface CodeGenOptions {
  language: CodeGenLanguage
}

// ---------------------------------------------------------------------------
// Variable name generation
// ---------------------------------------------------------------------------

function varName(label: string): string {
  return label
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .replace(/^(\d)/, '_$1')
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const IDENT = '  '

/** Determine if a node connects directly to End via its edges (no further nodes). */
function isLastBeforeEnd(nodeId: string, graph: WorkflowGraph): boolean {
  return graph.edges.some(
    (e) => e.from === nodeId && graph.nodes.find((n) => n.id === e.to)?.kind === 'end'
  )
}

/** Wrap a block of code in an if/else structure when condition is present. */
interface ConditionRegion {
  condition: WorkflowNode
  thenNodes: WorkflowNode[]
  elseNodes?: WorkflowNode[]
}

function findConditionRegions(graph: WorkflowGraph): Map<string, ConditionRegion> {
  const regions = new Map<string, ConditionRegion>()
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

  for (const node of graph.nodes) {
    if (node.kind !== 'condition') continue

    const thenCount = node.thenCount ?? 1
    const condIdx = graph.nodes.indexOf(node)
    const thenNodes = graph.nodes.slice(condIdx + 1, condIdx + 1 + thenCount)

    // Find elseNodes: nodes reachable via "no" edge from the condition,
    // which are not in the then-branch.
    const noEdge = graph.edges.find((e) => e.from === node.id && e.label === 'no')
    let elseNodes: WorkflowNode[] | undefined
    if (noEdge) {
      const noTarget = nodeMap.get(noEdge.to)
      if (noTarget && noTarget.kind !== 'end') {
        const noIdx = graph.nodes.indexOf(noTarget)
        if (noIdx > condIdx + thenCount) {
          elseNodes = graph.nodes.slice(noIdx)
            .filter((n) => n.kind !== 'end')
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
  generatedIds: Set<string>
): string {
  const pad = IDENT.repeat(indent)
  const vname = varName(node.label)
  generatedIds.add(node.id)

  // Check if this node is inside a condition then-branch already handled
  // by skipping: condition regions handle their children.

  switch (node.kind) {
    case 'step': {
      let sem = ''
      if (node.stepSemantics === 'AtMostOncePerRetry') sem = ', { semantics: StepSemantics.AT_MOST_ONCE_PER_RETRY }'
      return `${pad}const ${vname} = await context.step('${node.label}', async () => {\n${pad}${IDENT}// TODO: implement ${node.label}\n${pad}}${sem});\n`
    }

    case 'invoke': {
      const funcRef = node.target ?? 'MyFunction'
      let tenant = ''
      if (node.tenantId) tenant = `, { tenantId: '${node.tenantId}' }`
      return `${pad}const ${vname} = await context.invoke('${node.label}', '${funcRef}', {\n${pad}${IDENT}// TODO: input payload\n${pad}}${tenant});\n`
    }

    case 'wait': {
      return `${pad}await context.wait('${node.label}', { seconds: 30 });\n`
    }

    case 'waitForCallback': {
      let timeout = ''
      if (node.timeout) timeout = `, { timeout: { ${node.timeout} } }`
      return `${pad}const ${vname} = await context.waitForCallback('${node.label}', async (callbackId) => {\n${pad}${IDENT}// TODO: notify external system with callbackId\n${pad}}${timeout});\n`
    }

    case 'createCallback': {
      let timeout = ''
      if (node.timeout) timeout = `, { timeout: { ${node.timeout} } }`
      return `${pad}const ${vname} = await context.createCallback('${node.label}'${timeout});\n`
    }

    case 'waitForCondition': {
      return `${pad}const ${vname} = await context.waitForCondition('${node.label}', async (state) => {\n${pad}${IDENT}// TODO: poll and update state\n${pad}${IDENT}return { /* updated state */ };\n${pad}}, {\n${pad}${IDENT}initialState: { /* ... */ },\n${pad}${IDENT}waitStrategy: createWaitStrategy({ maxAttempts: 10, initialDelay: { seconds: 5 } })\n${pad}});\n`
    }

    case 'parallel': {
      if (!node.branches?.length) {
        return `${pad}const ${vname} = await context.parallel('${node.label}', []);\n`
      }
      let opts = ''
      if (node.nestingType === 'FLAT') opts += ', { nestingType: NestingType.FLAT }'
      else if (node.completionConfig) opts += `, { completionConfig: CompletionConfig.${node.completionConfig.replace(/\s+/g, '')} }`

      const branches = node.branches.map((b) => {
        const bLabel = b.nodes.map((bn) => bn.label).join(', ')
        return `${pad}${IDENT}{\n${pad}${IDENT}${IDENT}name: '${b.name}',\n${pad}${IDENT}${IDENT}func: async (ctx) => {\n${pad}${IDENT}${IDENT}${IDENT}// TODO: ${bLabel}\n${pad}${IDENT}${IDENT}},\n${pad}${IDENT}}`
      }).join(',\n')

      return `${pad}const ${vname} = await context.parallel('${node.label}', [\n${branches}\n${pad}]${opts});\n`
    }

    case 'map': {
      if (!node.branches?.length) {
        return `${pad}const ${vname} = await context.map('${node.label}', []);\n`
      }
      let opts = ''
      if (node.nestingType === 'FLAT') opts += ', { nestingType: NestingType.FLAT }'

      const branches = node.branches.map((b) => {
        return `${pad}${IDENT}ctx.step('${b.name}', async () => {\n${pad}${IDENT}${IDENT}// TODO: process ${b.name}\n${pad}${IDENT}}),`
      }).join('\n')

      return `${pad}const ${vname} = await context.map('${node.label}', [\n${pad}${IDENT}async (ctx) => {\n${branches}\n${pad}${IDENT}},\n${pad}]${opts});\n`
    }

    case 'withRetry': {
      let opts = ''
      if (node.retryStrategy) opts += `, { retryStrategy: ${node.retryStrategy} }`
      else if (node.nestingType === 'FLAT') opts += ', { virtualContext: true }'
      return `${pad}const ${vname} = await withRetry(context, '${node.label}', async () => {\n${pad}${IDENT}// TODO: implement ${node.label} with retry\n${pad}}${opts});\n`
    }

    case 'runInChildContext': {
      let opts = ''
      if (node.nestingType === 'FLAT') opts += ', { isVirtual: true }'
      return `${pad}const ${vname} = await context.runInChildContext('${node.label}', async (childCtx) => {\n${pad}${IDENT}// TODO: implement ${node.label} in child context\n${pad}}${opts});\n`
    }

    case 'promiseAll':
      return `${pad}const ${vname} = await context.promise.all('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);\n`
    case 'promiseAny':
      return `${pad}const ${vname} = await context.promise.any('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);\n`
    case 'promiseRace':
      return `${pad}const ${vname} = await context.promise.race('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);\n`
    case 'promiseAllSettled':
      return `${pad}const ${vname} = await context.promise.allSettled('${node.label}', [\n${pad}${IDENT}// TODO: add promises\n${pad}]);\n`

    case 'condition':
    case 'start':
    case 'end':
      return ''
  }
}

export function generateTypeScript(graph: WorkflowGraph): string {
  const conditionRegions = findConditionRegions(graph)
  const generatedIds = new Set<string>()
  const lines: string[] = []

  const needsWithRetry = graph.nodes.some((n) => n.kind === 'withRetry')
  const needsConfig = graph.nodes.some((n) =>
    n.nestingType === 'FLAT' || n.completionConfig || n.stepSemantics === 'AtMostOncePerRetry'
  )
  const needsWaitStrategy = graph.nodes.some((n) => n.kind === 'waitForCondition')

  const contextType = needsConfig || needsWaitStrategy ? '' : ''
  const importLine = needsWaitStrategy
    ? `import { withDurableExecution, createWaitStrategy } from '@aws/durable-execution-sdk-js'`
    : `import { withDurableExecution } from '@aws/durable-execution-sdk-js'`
  lines.push(`${importLine};`)

  if (needsWithRetry) {
    // withRetry is re-exported from the SDK
  }
  if (needsConfig) {
    lines.push(`import { NestingType, CompletionConfig, StepSemantics } from '@aws/durable-execution-sdk-js';`)
  }

  lines.push('')
  lines.push(`export const handler = withDurableExecution(async (event, context) => {`)

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  const conditionNodeIds = new Set(Array.from(conditionRegions.keys()))
  let i = 0

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      const region = conditionRegions.get(node.id)
      if (region) {
        generatedIds.add(node.id)
        const condPad = IDENT

        // Emit if-statement
        lines.push(`${condPad}if (${node.condition ?? node.label}) {`)

        // Emit then-branch nodes
        for (const tn of region.thenNodes) {
          if (tn.kind !== 'start' && tn.kind !== 'end' && tn.kind !== 'condition') {
            lines.push(genTypeScriptNode(tn, 2, graph, conditionRegions, generatedIds))
          }
        }

        lines.push(`${condPad}}`)

        // Emit else-branch if any
        if (region.elseNodes && region.elseNodes.length > 0) {
          lines.push(`${condPad}} else {`)
          for (const en of region.elseNodes) {
            if (en.kind !== 'start' && en.kind !== 'end' && en.kind !== 'condition') {
              lines.push(genTypeScriptNode(en, 2, graph, conditionRegions, generatedIds))
            }
          }
          lines.push(`${condPad}}`)
        }

        lines.push('')
        i += (node.thenCount ?? 1) + 1
        continue
      }
    }

    if (node.kind === 'parallel' || node.kind === 'map') {
      lines.push(genTypeScriptNode(node, 1, graph, conditionRegions, generatedIds))
      lines.push('')
      i++
      continue
    }

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    const code = genTypeScriptNode(node, 1, graph, conditionRegions, generatedIds)
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

  lines.push('from aws_durable_execution_sdk_python import (')
  lines.push(`${IDENT}DurableContext,`)
  lines.push(`${IDENT}durable_execution,`)
  lines.push(')')
  lines.push('')
  lines.push('@durable_execution')
  lines.push(`def handler(event: dict, context: DurableContext) -> dict:`)

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      const region = conditionRegions.get(node.id)
      if (region) {
        generatedIds.add(node.id)
        const pad = IDENT

        lines.push(`${pad}if ${node.condition ?? node.label}:`)

        for (const tn of region.thenNodes) {
          if (tn.kind !== 'start' && tn.kind !== 'end' && tn.kind !== 'condition') {
            lines.push(genPythonNode(tn, 2, generatedIds))
          }
        }

        if (region.elseNodes && region.elseNodes.length > 0) {
          lines.push(`${pad}else:`)
          for (const en of region.elseNodes) {
            if (en.kind !== 'start' && en.kind !== 'end' && en.kind !== 'condition') {
              lines.push(genPythonNode(en, 2, generatedIds))
            }
          }
        }

        lines.push('')
        i += (node.thenCount ?? 1) + 1
        continue
      }
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
  const vname = varName(node.label)
  generatedIds.add(node.id)

  switch (node.kind) {
    case 'step':
      return `${pad}context.step(name="${node.label}")  # TODO: implement ${node.label}\n`
    case 'invoke':
      return `${pad}context.invoke(function_name="${node.target ?? 'MyFunction'}", name="${node.label}", payload={})  # TODO: input payload\n`
    case 'wait':
      return `${pad}context.wait(duration=Duration.from_seconds(30), name="${node.label}")\n`
    case 'waitForCallback':
      return `${pad}context.wait_for_callback(name="${node.label}", callback_fn=lambda callback_id: None)  # TODO: notify external system\n`
    case 'createCallback':
      return `${pad}context.create_callback(name="${node.label}")\n`
    case 'waitForCondition':
      return `${pad}context.wait_for_condition(name="${node.label}", poll_fn=lambda state: state, config=WaitForConditionConfig(initial_state={}, max_attempts=10))\n`
    case 'parallel':
      if (!node.branches?.length) return `${pad}context.parallel(name="${node.label}", branches=[])\n`
      return `${pad}context.parallel(name="${node.label}", branches=[${node.branches.map((b) => b.name).join(', ')}])\n`
    case 'map':
      return `${pad}context.map(name="${node.label}", items=[])  # TODO: map items\n`
    case 'withRetry':
      return `${pad}context.with_retry(name="${node.label}", fn=lambda: None)  # TODO: implement with retry\n`
    case 'runInChildContext':
      return `${pad}context.run_in_child_context(name="${node.label}", fn=lambda child_ctx: None)  # TODO: implement in child context\n`
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
  const className = toPascalCase(graph.name) || 'WorkflowHandler'
  const lines: string[] = []

  lines.push('import software.amazon.lambda.durable.DurableHandler;')
  lines.push('import software.amazon.lambda.durable.DurableContext;')
  lines.push('')
  lines.push(`public class ${className} extends DurableHandler<Object, Object> {`)
  lines.push('')
  lines.push(`${IDENT}@Override`)
  lines.push(`${IDENT}protected Object handleRequest(Object input, DurableContext ctx) {`)

  const workflowNodes = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end')
  let i = 0

  while (i < workflowNodes.length) {
    const node = workflowNodes[i]

    if (generatedIds.has(node.id)) {
      i++
      continue
    }

    if (node.kind === 'condition') {
      const region = conditionRegions.get(node.id)
      if (region) {
        generatedIds.add(node.id)
        const pad = IDENT.repeat(2)

        lines.push(`${pad}if (${node.condition ?? node.label}) {`)

        for (const tn of region.thenNodes) {
          if (tn.kind !== 'start' && tn.kind !== 'end' && tn.kind !== 'condition') {
            lines.push(genJavaNode(tn, 3, generatedIds))
          }
        }

        lines.push(`${pad}}`)

        if (region.elseNodes && region.elseNodes.length > 0) {
          lines.push(`${pad} else {`)
          for (const en of region.elseNodes) {
            if (en.kind !== 'start' && en.kind !== 'end' && en.kind !== 'condition') {
              lines.push(genJavaNode(en, 3, generatedIds))
            }
          }
          lines.push(`${pad}}`)
        }

        lines.push('')
        i += (node.thenCount ?? 1) + 1
        continue
      }
    }

    if (!generatedIds.has(node.id)) {
      const code = genJavaNode(node, 2, generatedIds)
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
  generatedIds: Set<string>
): string {
  const pad = IDENT.repeat(indent)
  const vname = varName(node.label)
  generatedIds.add(node.id)

  switch (node.kind) {
    case 'step':
      return `${pad}var ${vname} = ctx.step("${node.label}", Object.class, stepCtx -> {\n${pad}${IDENT}// TODO: implement ${node.label}\n${pad}${IDENT}return null;\n${pad}});\n`
    case 'invoke':
      return `${pad}var ${vname} = ctx.invoke("${node.label}", "${node.target ?? 'MyFunction'}", Object.class, input -> {\n${pad}${IDENT}// TODO: input payload\n${pad}${IDENT}return null;\n${pad}});\n`
    case 'wait':
      return `${pad}ctx.wait(Duration.ofSeconds(30));\n`
    case 'waitForCallback':
      return `${pad}var ${vname} = ctx.waitForCallback("${node.label}", callbackId -> {\n${pad}${IDENT}// TODO: notify external system with callbackId\n${pad}});\n`
    case 'createCallback':
      return `${pad}var ${vname} = ctx.createCallback("${node.label}");\n`
    case 'waitForCondition':
      return `${pad}var ${vname} = ctx.waitForCondition("${node.label}", state -> {\n${pad}${IDENT}// TODO: poll and update state\n${pad}${IDENT}return state;\n${pad}}, WaitForConditionConfig.builder()\n${pad}${IDENT}.initialState(/* ... */)\n${pad}${IDENT}.maxAttempts(10)\n${pad}${IDENT}.build());\n`
    case 'parallel':
      if (!node.branches?.length) return `${pad}var ${vname} = ctx.parallel("${node.label}");\n${pad}${vname}.get();\n`
      return `${pad}var ${vname} = ctx.parallel("${node.label}");\n${node.branches.map((b) => `${pad}${vname}.branch("${b.name}", Object.class, branchCtx -> {\n${pad}${IDENT}// TODO: implement ${b.name}\n${pad}${IDENT}return null;\n${pad}});`).join('\n')}\n${pad}${vname}.get();\n`
    case 'map':
      return `${pad}var ${vname} = ctx.map("${node.label}", items, Object.class, (item, mapCtx) -> {\n${pad}${IDENT}// TODO: process item\n${pad}${IDENT}return null;\n${pad}});\n`
    case 'withRetry':
      return `${pad}var ${vname} = ctx.withRetry("${node.label}", retryCtx -> {\n${pad}${IDENT}// TODO: implement ${node.label} with retry\n${pad}${IDENT}return null;\n${pad}});\n`
    case 'runInChildContext':
      return `${pad}var ${vname} = ctx.runInChildContext("${node.label}", childCtx -> {\n${pad}${IDENT}// TODO: implement ${node.label} in child context\n${pad}${IDENT}return null;\n${pad}});\n`
    default:
      return ''
  }
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
