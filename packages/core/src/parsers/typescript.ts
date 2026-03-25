/**
 * TypeScript/JavaScript parser for durable function handlers.
 *
 * Uses ts-morph to find durable primitives and build a WorkflowGraph.
 * Follows function references: if the handler calls a helper function
 * that accepts a DurableContext and contains durable calls, those calls
 * are inlined at the call site in the graph.
 */

import {
  Project,
  SyntaxKind,
  type CallExpression,
  type Node,
  type Block,
  type IfStatement,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph'
import type { WorkflowNode, WorkflowBranch, WorkflowGraph } from '../graph.js'
import { buildEdges } from '../graph.js'
import type { Parser, ParseOptions } from '../parser.js'

// ---------------------------------------------------------------------------
// ID generation (reset per parse call)
// ---------------------------------------------------------------------------

let nodeCounter = 0

function nextId(prefix: string): string {
  return `${prefix}_${++nodeCounter}`
}

function resetIds(): void {
  nodeCounter = 0
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/** Extract the first string literal argument from a call expression. */
function getStringArg(call: CallExpression, index: number): string | undefined {
  const arg = call.getArguments()[index]
  if (!arg) return undefined
  if (arg.getKind() === SyntaxKind.StringLiteral) {
    return arg.getText().replace(/^['"]|['"]$/g, '')
  }
  if (arg.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return arg.getText().replace(/^`|`$/g, '')
  }
  return undefined
}

/**
 * Check if a call expression targets <obj>.<method>() where obj
 * is any of the known context parameter names.
 */
function isDurableCall(node: Node, method: string, contextNames: Set<string>): boolean {
  if (node.getKind() !== SyntaxKind.CallExpression) return false
  const call = node as CallExpression
  const expr = call.getExpression()
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const text = expr.getText()
    for (const name of contextNames) {
      if (text === `${name}.${method}`) return true
    }
  }
  return false
}

/** Check if a call is <contextName>.promise.<method>(). */
function isPromiseCall(node: Node, method: string, contextNames: Set<string>): boolean {
  if (node.getKind() !== SyntaxKind.CallExpression) return false
  const call = node as CallExpression
  const expr = call.getExpression()
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const text = expr.getText()
    for (const name of contextNames) {
      if (text === `${name}.promise.${method}`) return true
    }
  }
  return false
}

/** Extract retry strategy info from options argument. */
function getRetryStrategy(call: CallExpression): string | undefined {
  const args = call.getArguments()
  const lastArg = args[args.length - 1]
  if (!lastArg) return undefined
  const text = lastArg.getText()
  const match = text.match(/retryStrategy\s*:\s*(\w+)/)
  return match?.[1]
}

/** Extract timeout info from options argument. */
function getTimeoutInfo(call: CallExpression): string | undefined {
  const args = call.getArguments()
  for (const arg of args) {
    const text = arg.getText()
    const match = text.match(/timeout\s*:\s*\{([^}]+)\}/)
    if (match) return match[1].trim()
  }
  return undefined
}

/** Get 1-based source line number for an AST node. */
function lineOf(node: Node): number {
  return node.getStartLineNumber()
}

/** Mark all descendant call expressions as consumed. */
function markDescendants(call: CallExpression, consumed: Set<number>): void {
  for (const desc of call.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    consumed.add(desc.getStart())
  }
}

/** Get child statements from a block or single statement. */
function getChildStatements(node: Node): Node[] {
  if (node.getKind() === SyntaxKind.Block) {
    return (node as Block).getStatements()
  }
  return [node]
}

// ---------------------------------------------------------------------------
// Function-reference resolution
// ---------------------------------------------------------------------------

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression

/**
 * Build a map of function name → function body for all functions in the
 * source file that accept a DurableContext parameter.
 *
 * This enables following calls like `closeTicket(context, ...)` where
 * `closeTicket` is defined in the same file and uses context.parallel() etc.
 */
function buildDurableFunctionMap(sourceFile: SourceFile): Map<string, { body: Block; contextParam: string }> {
  const map = new Map<string, { body: Block; contextParam: string }>()

  // Named function declarations
  for (const fn of sourceFile.getFunctions()) {
    const entry = extractDurableFunction(fn)
    if (entry) {
      const name = fn.getName()
      if (name) map.set(name, entry)
    }
  }

  // Variable declarations: const foo = async (...) => { ... }
  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const init = varDecl.getInitializer()
    if (!init) continue
    const fn = init.getKind() === SyntaxKind.ArrowFunction
      ? init as ArrowFunction
      : init.getKind() === SyntaxKind.FunctionExpression
        ? init as FunctionExpression
        : undefined
    if (!fn) continue
    const entry = extractDurableFunction(fn)
    if (entry) map.set(varDecl.getName(), entry)
  }

  return map
}

/** Check if a function-like node has a DurableContext parameter and a body. */
function extractDurableFunction(fn: FunctionLike): { body: Block; contextParam: string } | undefined {
  const params = fn.getParameters()
  for (const param of params) {
    const typeText = param.getTypeNode()?.getText() ?? ''
    if (typeText.includes('DurableContext')) {
      const body = fn.getBody()
      if (body && body.getKind() === SyntaxKind.Block) {
        return { body: body as Block, contextParam: param.getName() }
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Registry resolution for dynamic parallel branches
// ---------------------------------------------------------------------------

/**
 * Try to resolve the keys of a registry object used inside a .map() callback.
 *
 * Looks for patterns like `REGISTRY[item.prop]` where REGISTRY is a
 * module-scope object literal, and returns its keys.
 */
function resolveRegistryKeys(mapArg: Node, sourceFile: SourceFile): string[] {
  // Find element access expressions like REGISTRY[spec.name]
  const elementAccesses = mapArg.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)

  for (const access of elementAccesses) {
    const objName = access.getExpression().getText()
    // Skip if it's a complex expression (only want simple identifiers like SPECIALISTS)
    if (objName.includes('.') || objName.includes('(')) continue

    // Try to find a module-scope variable declaration with this name
    const varDecl = sourceFile.getVariableDeclaration(objName)
    if (!varDecl) continue

    const init = varDecl.getInitializer()
    if (!init) continue

    // Check if it's an object literal
    if (init.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const objLiteral = init.asKind(SyntaxKind.ObjectLiteralExpression)
      if (!objLiteral) continue

      const keys: string[] = []
      for (const prop of objLiteral.getProperties()) {
        if (prop.getKind() === SyntaxKind.PropertyAssignment) {
          const propName = prop.asKind(SyntaxKind.PropertyAssignment)?.getName()
          if (propName) keys.push(propName.replace(/^['"]|['"]$/g, ''))
        }
      }
      if (keys.length > 0) return keys
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Parallel branch extraction
// ---------------------------------------------------------------------------

function extractParallelBranches(call: CallExpression, contextNames: Set<string>, sourceFile: SourceFile): WorkflowBranch[] {
  const branches: WorkflowBranch[] = []
  const secondArg = call.getArguments()[1]
  if (!secondArg) return branches

  const text = secondArg.getText()

  // Pattern: .map() — dynamic branches
  if (text.includes('.map(')) {
    const invokeCalls = secondArg.getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((c) => {
        const expr = c.getExpression().getText()
        return expr.endsWith('.invoke')
      })

    if (invokeCalls.length > 0) {
      // Try to resolve the registry object that the .map() iterates over.
      // Pattern: REGISTRY[item.key] inside the .map() callback, where
      // REGISTRY is a module-scope object with known keys.
      const registryKeys = resolveRegistryKeys(secondArg, sourceFile)

      if (registryKeys.length > 0) {
        // We know all possible branches — enumerate them
        for (const key of registryKeys) {
          branches.push({
            name: key,
            dynamic: true,
            nodes: [{
              id: nextId('invoke'),
              kind: 'invoke',
              label: key,
            }],
          })
        }
      } else {
        // Fallback: single representative branch
        const seen = new Set<string>()
        for (const invokeCall of invokeCalls) {
          const stepName = getStringArg(invokeCall, 0)
          const functionRef = getStringArg(invokeCall, 1) ?? invokeCall.getArguments()[1]?.getText()
          const key = `${stepName}:${functionRef}`
          if (seen.has(key)) continue
          seen.add(key)
          branches.push({
            name: stepName ?? 'specialist',
            dynamic: true,
            nodes: [{
              id: nextId('invoke'),
              kind: 'invoke',
              label: stepName ?? 'invoke',
              target: functionRef,
            }],
          })
        }
      }
    }

    const stepCalls = secondArg.getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((c) => {
        const expr = c.getExpression().getText()
        return expr.endsWith('.step')
      })

    if (stepCalls.length > 0 && invokeCalls.length === 0) {
      for (const stepCall of stepCalls) {
        const stepName = getStringArg(stepCall, 0)
        branches.push({
          name: stepName ?? 'step',
          dynamic: true,
          nodes: [{
            id: nextId('step'),
            kind: 'step',
            label: stepName ?? 'step',
          }],
        })
      }
    }

    return branches
  }

  // Pattern: static array of branch objects
  const arrayLiteral = secondArg.getKind() === SyntaxKind.ArrayLiteralExpression
    ? secondArg
    : secondArg.getFirstDescendantByKind(SyntaxKind.ArrayLiteralExpression)

  if (arrayLiteral) {
    const elements = arrayLiteral.asKind(SyntaxKind.ArrayLiteralExpression)?.getElements() ?? []
    for (const element of elements) {
      const nameMatch = element.getText().match(/name\s*:\s*['"]([^'"]+)['"]/)
      const branchName = nameMatch?.[1] ?? 'branch'
      const branchNodes: WorkflowNode[] = []

      const invokeCalls = element.getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((c) => c.getExpression().getText().endsWith('.invoke'))

      for (const invokeCall of invokeCalls) {
        const invStepName = getStringArg(invokeCall, 0)
        const functionRef = getStringArg(invokeCall, 1) ?? invokeCall.getArguments()[1]?.getText()
        branchNodes.push({
          id: nextId('invoke'),
          kind: 'invoke',
          label: invStepName ?? branchName,
          target: functionRef,
        })
      }

      const stepCalls = element.getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter((c) => c.getExpression().getText().endsWith('.step'))

      for (const stepCall of stepCalls) {
        const stepName = getStringArg(stepCall, 0)
        branchNodes.push({
          id: nextId('step'),
          kind: 'step',
          label: stepName ?? 'step',
          retryStrategy: getRetryStrategy(stepCall),
        })
      }

      if (branchNodes.length === 0) {
        branchNodes.push({
          id: nextId('branch'),
          kind: 'step',
          label: branchName,
        })
      }

      branches.push({ name: branchName, dynamic: false, nodes: branchNodes })
    }
  }

  return branches
}

// ---------------------------------------------------------------------------
// Core extraction logic
// ---------------------------------------------------------------------------

/**
 * Walk statements and extract durable primitives in order.
 *
 * @param statements - AST statements to scan
 * @param contextNames - parameter names that refer to the DurableContext
 * @param durableFunctions - map of helper function names → bodies
 * @param visited - prevents infinite recursion for recursive helpers
 * @param sourceFile - the source file (for resolving registry objects)
 */
function extractFromBlock(
  statements: Node[],
  contextNames: Set<string>,
  durableFunctions: Map<string, { body: Block; contextParam: string }>,
  visited: Set<string>,
  sourceFile: SourceFile,
): WorkflowNode[] {
  const nodes: WorkflowNode[] = []

  for (const stmt of statements) {
    // Check for if-statements that wrap durable calls
    if (stmt.getKind() === SyntaxKind.IfStatement) {
      const ifStmt = stmt as IfStatement
      const thenBlock = ifStmt.getThenStatement()
      const conditionText = ifStmt.getExpression().getText()

      const thenNodes = extractFromBlock(
        thenBlock.getDescendantStatements?.() ?? getChildStatements(thenBlock),
        contextNames,
        durableFunctions,
        visited,
        sourceFile,
      )

      if (thenNodes.length > 0) {
        // Check if the then-block ends with a return statement
        const thenStatements = getChildStatements(thenBlock)
        const lastStmt = thenStatements[thenStatements.length - 1]
        const thenReturns = lastStmt?.getKind() === SyntaxKind.ReturnStatement

        nodes.push({
          id: nextId('cond'),
          kind: 'condition',
          label: conditionText,
          condition: conditionText,
          thenCount: thenNodes.length,
          thenReturns,
          sourceLine: lineOf(ifStmt),
        })
        nodes.push(...thenNodes)
        continue
      }
    }

    // Find all call expressions in this statement
    const calls = stmt.getDescendantsOfKind(SyntaxKind.CallExpression)
    const consumed = new Set<number>()

    for (const call of calls) {
      if (consumed.has(call.getStart())) continue

      // --- Durable primitives ---

      if (isDurableCall(call, 'step', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({
          id: nextId('step'),
          kind: 'step',
          label: name ?? 'step',
          retryStrategy: getRetryStrategy(call),
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'parallel', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        const branches = extractParallelBranches(call, contextNames, sourceFile)
        nodes.push({
          id: nextId('parallel'),
          kind: 'parallel',
          label: name ?? 'parallel',
          branches,
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'waitForCallback', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({
          id: nextId('callback'),
          kind: 'waitForCallback',
          label: name ?? 'waitForCallback',
          timeout: getTimeoutInfo(call),
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'wait', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        const hasDuration = call.getArguments()[0]?.getKind() === SyntaxKind.ObjectLiteralExpression
        const durationArg = hasDuration ? call.getArguments()[0] : call.getArguments()[1]
        nodes.push({
          id: nextId('wait'),
          kind: 'wait',
          label: name && !hasDuration ? `wait: ${name}` : 'wait',
          timeout: durationArg?.getText(),
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'waitForCondition', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({
          id: nextId('waitcond'),
          kind: 'waitForCondition',
          label: name ?? 'waitForCondition',
          timeout: getTimeoutInfo(call),
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'createCallback', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({
          id: nextId('createcb'),
          kind: 'createCallback',
          label: name ?? 'createCallback',
          timeout: getTimeoutInfo(call),
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'runInChildContext', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({
          id: nextId('child'),
          kind: 'runInChildContext',
          label: name ?? 'childContext',
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'map', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        const branches = extractParallelBranches(call, contextNames, sourceFile)
        nodes.push({
          id: nextId('map'),
          kind: 'map',
          label: name ?? 'map',
          branches,
          sourceLine: lineOf(call),
        })
      } else if (isDurableCall(call, 'invoke', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        const functionRef = getStringArg(call, 1) ?? call.getArguments()[1]?.getText()
        nodes.push({
          id: nextId('invoke'),
          kind: 'invoke',
          label: name ?? 'invoke',
          target: functionRef,
          sourceLine: lineOf(call),
        })
      } else if (isPromiseCall(call, 'all', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({ id: nextId('pall'), kind: 'promiseAll', label: name ?? 'promise.all', sourceLine: lineOf(call) })
      } else if (isPromiseCall(call, 'any', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({ id: nextId('pany'), kind: 'promiseAny', label: name ?? 'promise.any', sourceLine: lineOf(call) })
      } else if (isPromiseCall(call, 'race', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({ id: nextId('prace'), kind: 'promiseRace', label: name ?? 'promise.race', sourceLine: lineOf(call) })
      } else if (isPromiseCall(call, 'allSettled', contextNames)) {
        markDescendants(call, consumed)
        const name = getStringArg(call, 0)
        nodes.push({ id: nextId('psettled'), kind: 'promiseAllSettled', label: name ?? 'promise.allSettled', sourceLine: lineOf(call) })
      } else {
        // --- Function-reference following ---
        // Check if this is a call to a helper function that uses DurableContext.
        const calledName = resolveCalledFunctionName(call)
        if (calledName && durableFunctions.has(calledName) && !visited.has(calledName)) {
          markDescendants(call, consumed)
          const entry = durableFunctions.get(calledName)!
          visited.add(calledName)

          // The helper's context parameter name becomes a valid context name
          const childContextNames = new Set(contextNames)
          childContextNames.add(entry.contextParam)

          const inlinedNodes = extractFromBlock(
            entry.body.getStatements(),
            childContextNames,
            durableFunctions,
            visited,
            sourceFile,
          )
          nodes.push(...inlinedNodes)

          visited.delete(calledName)
        }
      }
    }
  }

  return nodes
}

/** Resolve the function name from a simple call expression (e.g. `closeTicket(...)` → "closeTicket"). */
function resolveCalledFunctionName(call: CallExpression): string | undefined {
  const expr = call.getExpression()
  // Simple identifier: closeTicket(...)
  if (expr.getKind() === SyntaxKind.Identifier) {
    return expr.getText()
  }
  // Could add: this.method(), imported.function(), etc.
  return undefined
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class TypeScriptParser implements Parser {
  extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']

  parseFile(filePath: string, options?: ParseOptions): WorkflowGraph {
    resetIds()

    const project = new Project({
      compilerOptions: { allowJs: true },
      skipAddingFilesFromTsConfig: true,
    })

    const sourceFile = project.addSourceFileAtPath(filePath)
    const fileName = sourceFile.getBaseNameWithoutExtension()
    const name = options?.name ?? fileName

    // Build map of helper functions that accept DurableContext
    const durableFunctions = buildDurableFunctionMap(sourceFile)

    // Find withDurableExecution() calls
    const durableCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => call.getExpression().getText() === 'withDurableExecution')

    if (durableCalls.length === 0) {
      throw new Error(`No withDurableExecution() call found in ${filePath}`)
    }

    const durableCall = durableCalls[0]
    const handlerArg = durableCall.getArguments()[0]
    if (!handlerArg) {
      throw new Error('withDurableExecution() has no handler argument')
    }

    const body = handlerArg.getFirstDescendantByKind(SyntaxKind.Block)
    if (!body) {
      throw new Error('Handler function has no body')
    }

    // Determine the context parameter name from the handler signature
    const contextNames = new Set<string>()
    const handlerParams = handlerArg.getDescendantsOfKind(SyntaxKind.Parameter)
    for (const param of handlerParams) {
      const typeText = param.getTypeNode()?.getText() ?? ''
      if (typeText.includes('DurableContext')) {
        contextNames.add(param.getName())
      }
    }
    // Fallback: assume common names if no typed parameter found
    if (contextNames.size === 0) {
      contextNames.add('context')
      contextNames.add('ctx')
    }

    const workflowNodes = extractFromBlock(
      body.getStatements(),
      contextNames,
      durableFunctions,
      new Set(),
      sourceFile,
    )

    const startNode: WorkflowNode = { id: 'node_start', kind: 'start', label: 'Start' }
    const endNode: WorkflowNode = { id: 'node_end', kind: 'end', label: 'End' }
    const allNodes = [startNode, ...workflowNodes, endNode]
    const edges = buildEdges(allNodes)

    return { name, nodes: allNodes, edges }
  }
}
