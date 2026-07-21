import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { generateCode } from './codegen.js'
import { parseFile } from '../parser.js'
import type { WorkflowGraph, WorkflowNode, WorkflowBranch } from '../graph.js'

const examplesDir = resolve(import.meta.dirname, '../../../..', 'examples')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, kind: WorkflowNode['kind'], label: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, kind, label, ...overrides }
}

function makeBranch(name: string, nodes: WorkflowNode[]): WorkflowBranch {
  return { name, dynamic: false, nodes }
}

function makeGraph(name: string, nodes: WorkflowNode[], edges?: { from: string; to: string; label?: string }[]): WorkflowGraph {
  return { name, nodes: [{ id: 'node_start', kind: 'start', label: 'Start' }, ...nodes, { id: 'node_end', kind: 'end', label: 'End' }], edges: edges ?? [] }
}

function assertContains(code: string, ...substrings: string[]) {
  for (const s of substrings) {
    assert.ok(code.includes(s), `Expected code to contain:\n  "${s}"\n\nGot:\n${code}`)
  }
}

function assertNotContains(code: string, ...substrings: string[]) {
  for (const s of substrings) {
    assert.ok(!code.includes(s), `Expected code NOT to contain:\n  "${s}"\n\nGot:\n${code}`)
  }
}

// ---------------------------------------------------------------------------
// Single primitive per language
// ---------------------------------------------------------------------------

for (const [lang, stepCall, invokeCall, waitCall] of [
  ['typescript', "context.step('my-step'", "context.invoke('my-invoke', 'MyFunc'", "context.wait('my-wait'"],
  ['python', 'context.step(func=lambda step_ctx: None, name="my-step"', 'context.invoke(function_name="MyFunc", payload={}, name="my-invoke"', 'context.wait(duration=Duration.from_seconds(30), name="my-wait"'],
  ['java', 'ctx.step("my-step", Object.class', 'ctx.invoke("my-invoke", "MyFunc", Object.class', 'ctx.wait("my-wait", Duration.ofSeconds(30))'],
  ['csharp', 'ctx.StepAsync', 'ctx.InvokeAsync<object, object>', 'ctx.WaitAsync'],
] as const) {
  const langStr = String(lang)

  describe(`${langStr}: basic primitives`, () => {
    it('step', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'my-step')]), { language: lang })
      assertContains(code, stepCall)
    })

    it('invoke', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'invoke', 'my-invoke', { target: 'MyFunc' })]), { language: lang })
      assertContains(code, invokeCall)
    })

    it('wait', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'wait', 'my-wait')]), { language: lang })
      assertContains(code, waitCall)
    })

    it('waitForCallback', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'waitForCallback', 'my-callback')]), { language: lang })
      assertContains(code, 'my-callback')
      assertContains(code, 'TODO')
    })

    it('createCallback', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'createCallback', 'create-cb')]), { language: lang })
      assertContains(code, 'create-cb')
    })

    it('waitForCondition', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'waitForCondition', 'poll-status')]), { language: lang })
      assertContains(code, 'poll-status')
    })

    it('runInChildContext', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'runInChildContext', 'child-work')]), { language: lang })
      assertContains(code, 'child-work')
    })

    it('withRetry', () => {
      const code = generateCode(makeGraph('test', [makeNode('a', 'withRetry', 'retry-op')]), { language: lang })
      assertContains(code, 'retry-op')
      if (lang === 'typescript') assertContains(code, 'retryStrategy')
    })
  })
}

// ---------------------------------------------------------------------------
// TypeScript-specific primitives
// ---------------------------------------------------------------------------

describe('TypeScript: promise combinators', () => {
  it('promiseAll', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseAll', 'all-tasks')]), { language: 'typescript' })
    assertContains(code, "context.promise.all('all-tasks'")
  })

  it('promiseAny', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseAny', 'any-task')]), { language: 'typescript' })
    assertContains(code, "context.promise.any('any-task'")
  })

  it('promiseRace', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseRace', 'race-task')]), { language: 'typescript' })
    assertContains(code, "context.promise.race('race-task'")
  })

  it('promiseAllSettled', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseAllSettled', 'settled-tasks')]), { language: 'typescript' })
    assertContains(code, "context.promise.allSettled('settled-tasks'")
  })
})

// ---------------------------------------------------------------------------
// Imports generated conditionally
// ---------------------------------------------------------------------------

describe('TypeScript: conditional imports', () => {
  it('adds createWaitStrategy import when waitForCondition present', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'waitForCondition', 'poll')]), { language: 'typescript' })
    assertContains(code, 'createWaitStrategy')
  })

  it('adds NestingType/CompletionConfig import when FLAT nesting used', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'parallel', 'par', { nestingType: 'FLAT' })]), { language: 'typescript' })
    assertContains(code, 'NestingType')
  })

  it('does not add config imports when not needed', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 's')]), { language: 'typescript' })
    assertNotContains(code, 'NestingType')
    assertNotContains(code, 'createWaitStrategy')
  })
})

// ---------------------------------------------------------------------------
// Parallel
// ---------------------------------------------------------------------------

describe('Parallel', () => {
  it('empty parallel in TypeScript', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'parallel', 'par')]), { language: 'typescript' })
    assertContains(code, "context.parallel('par', [")
    assertContains(code, ']);')
  })

  it('parallel with branches in TypeScript', () => {
    const g = makeGraph('test', [
      makeNode('a', 'parallel', 'par', {
        branches: [
          makeBranch('branch-a', [makeNode('b1', 'step', 'do-a')]),
          makeBranch('branch-b', [makeNode('b2', 'step', 'do-b')]),
        ],
      }),
    ])
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, "context.parallel('par',")
    assertContains(code, "name: 'branch-a'")
    assertContains(code, "name: 'branch-b'")
    assertContains(code, "// TODO: do-a")
    assertContains(code, "// TODO: do-b")
  })

  it('parallel with FLAT nesting type in TypeScript', () => {
    const g = makeGraph('test', [
      makeNode('a', 'parallel', 'par', { nestingType: 'FLAT', branches: [makeBranch('b', [makeNode('b1', 'step', 'do')])] }),
    ])
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'NestingType.FLAT')
  })

  it('parallel with completionConfig in TypeScript', () => {
    const g = makeGraph('test', [
      makeNode('a', 'parallel', 'par', { completionConfig: 'firstSuccessful', branches: [makeBranch('b', [makeNode('b1', 'step', 'do')])] }),
    ])
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'CompletionConfig.firstSuccessful')
  })

  it('parallel with branches in Python', () => {
    const g = makeGraph('test', [
      makeNode('a', 'parallel', 'par', {
        branches: [makeBranch('validate', []), makeBranch('process', [])],
      }),
    ])
    const code = generateCode(g, { language: 'python' })
    assertContains(code, 'context.parallel(functions=[ParallelBranch(func=lambda ctx: None, name="validate"), ParallelBranch(func=lambda ctx: None, name="process")], name="par")')
  })

  it('parallel with branches in Java', () => {
    const g = makeGraph('test', [
      makeNode('a', 'parallel', 'par', {
        branches: [makeBranch('validate', []), makeBranch('process', [])],
      }),
    ])
    const code = generateCode(g, { language: 'java' })
    assertContains(code, 'ctx.parallel("par")')
    assertContains(code, '.branch("validate"')
    assertContains(code, '.branch("process"')
    assertContains(code, '.get()')
  })

  it('parallel with branches in C#', () => {
    const g = makeGraph('test', [
      makeNode('a', 'parallel', 'par', {
        branches: [makeBranch('validate', []), makeBranch('process', [])],
      }),
    ])
    const code = generateCode(g, { language: 'csharp' })
    assertContains(code, 'ctx.ParallelAsync')
    assertContains(code, 'DurableBranch')
    assertContains(code, '"validate"')
    assertContains(code, '"process"')
  })
})

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

describe('Map', () => {
  it('empty map in TypeScript', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'map', 'mapper')]), { language: 'typescript' })
    assertContains(code, "context.map('mapper', [")
  })

  it('map with branches in TypeScript', () => {
    const g = makeGraph('test', [
      makeNode('a', 'map', 'mapper', {
        branches: [makeBranch('process', [makeNode('b1', 'step', 'process-item')])],
      }),
    ])
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, "context.map('mapper', ['process']")
    assertContains(code, '// TODO: process process-item')
  })

  it('map with FLAT in TypeScript', () => {
    const g = makeGraph('test', [
      makeNode('a', 'map', 'mapper', { nestingType: 'FLAT', branches: [makeBranch('p', [makeNode('b1', 'step', 'do')])] }),
    ])
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'NestingType.FLAT')
  })

  it('map in Python', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'map', 'mapper')]), { language: 'python' })
    assertContains(code, 'context.map(inputs=[], func=lambda child_ctx, item, idx, items: None, name="mapper")')
  })

  it('map in Java', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'map', 'mapper')]), { language: 'java' })
    assertContains(code, 'ctx.map("mapper", items')
    assertContains(code, '// TODO: process item')
  })

  it('map in C#', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'map', 'mapper')]), { language: 'csharp' })
    assertContains(code, 'ctx.MapAsync<object, object>')
    assertContains(code, 'name: "mapper"')
  })
})

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

describe('Conditions', () => {
  it('simple if in TypeScript', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'check', thenCount: 1 },
        { id: 's1', kind: 'step', label: 'then-step' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 's1', label: 'yes' },
        { from: 'c1', to: 'node_end', label: 'no' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'if (check)')
    assertContains(code, "context.step('then-step'")
  })

  it('if-else in TypeScript', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'isValid', thenCount: 1 },
        { id: 's1', kind: 'step', label: 'then-step' },
        { id: 's2', kind: 'step', label: 'else-step' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 's1', label: 'yes' },
        { from: 'c1', to: 's2', label: 'no' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'if (isValid)')
    assertContains(code, "context.step('then-step'")
    assertContains(code, 'else')
    assertContains(code, "context.step('else-step'")
  })

  it('if without else (no-branch goes to end)', () => {
    // Node after then-branch in the nodes list means it falls through naturally
    // The condition node's thenCount controls how many following nodes are in the then-branch
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'shouldRun', thenCount: 1 },
        { id: 's1', kind: 'step', label: 'conditional-step' },
        { id: 's2', kind: 'step', label: 'after-condition' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 's1', label: 'yes' },
        { from: 'c1', to: 's2', label: 'no' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'if (shouldRun)')
    assertContains(code, "context.step('conditional-step'")
    assertContains(code, "context.step('after-condition'")
  })

  it('condition with thenReturns skips else', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'shouldReturn', thenCount: 1, thenReturns: true },
        { id: 's1', kind: 'step', label: 'then-return' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 's1', label: 'yes' },
        { from: 'c1', to: 'node_end', label: 'no' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'if (shouldReturn)')
    assertContains(code, "context.step('then-return'")
    // Should not have an else branch since thenReturns
    assert.equal(code.includes('} else {'), false)
  })

  it('condition in Python', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'is_valid', thenCount: 1 },
        { id: 's1', kind: 'step', label: 'then-step' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [{ from: 'c1', to: 's1', label: 'yes' }],
    }
    const code = generateCode(g, { language: 'python' })
    assertContains(code, 'if is_valid:')
    assertContains(code, 'context.step(func=lambda step_ctx: None, name="then-step"')
  })

  it('condition in Java', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'isValid', thenCount: 1 },
        { id: 's1', kind: 'step', label: 'then-step' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [{ from: 'c1', to: 's1', label: 'yes' }],
    }
    const code = generateCode(g, { language: 'java' })
    assertContains(code, 'if (isValid)')
    assertContains(code, 'ctx.step("then-step"')
  })

  it('condition in C#', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'isValid', thenCount: 1 },
        { id: 's1', kind: 'step', label: 'then-step' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [{ from: 'c1', to: 's1', label: 'yes' }],
    }
    const code = generateCode(g, { language: 'csharp' })
    assertContains(code, 'if (isValid)')
    assertContains(code, 'ctx.StepAsync')
    assertContains(code, '"then-step"')
  })

  it('multiple sequential conditions', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'first', condition: 'first', thenCount: 1 },
        { id: 's1', kind: 'step', label: 'first-then' },
        { id: 'c2', kind: 'condition', label: 'second', condition: 'second', thenCount: 1 },
        { id: 's2', kind: 'step', label: 'second-then' },
        { id: 's3', kind: 'step', label: 'after-all' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 's1', label: 'yes' },
        { from: 'c1', to: 'c2', label: 'no' },
        { from: 'c2', to: 's2', label: 'yes' },
        { from: 'c2', to: 's3', label: 'no' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'if (first)', 'if (second)', "context.step('first-then'", "context.step('second-then'")
  })

  it('convergence: both branches merge to same node', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'isValid', thenCount: 1 },
        { id: 'ifStep', kind: 'step', label: 'if-step' },
        { id: 'elseStep', kind: 'step', label: 'else-step' },
        { id: 'postStep', kind: 'step', label: 'post-step' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 'ifStep', label: 'yes' },
        { from: 'c1', to: 'elseStep', label: 'no' },
        { from: 'ifStep', to: 'postStep' },
        { from: 'elseStep', to: 'postStep' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'if (isValid)')
    assertContains(code, "context.step('if-step'")
    assertContains(code, 'else')
    assertContains(code, "context.step('else-step'")
    // post-step should be AFTER the if/else, not inside either branch
    const ifIdx = code.indexOf('if (isValid)')
    const elseIdx = code.indexOf('else')
    const postIdx = code.indexOf("context.step('post-step'")
    assert.ok(postIdx > elseIdx, 'post-step should come after else block')
  })

  it('convergence with downstream node from merge point', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'check', condition: 'isValid', thenCount: 1 },
        { id: 'ifStep', kind: 'step', label: 'if-step' },
        { id: 'elseStep', kind: 'step', label: 'else-step' },
        { id: 'postStep', kind: 'step', label: 'post-step' },
        { id: 'afterPost', kind: 'step', label: 'after-post' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 'ifStep', label: 'yes' },
        { from: 'c1', to: 'elseStep', label: 'no' },
        { from: 'ifStep', to: 'postStep' },
        { from: 'elseStep', to: 'postStep' },
        { from: 'postStep', to: 'afterPost' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, "context.step('if-step'")
    assertContains(code, "context.step('else-step'")
    assertContains(code, "context.step('post-step'")
    assertContains(code, "context.step('after-post'")
    // after-post should NOT be inside the else block
    const elseStr = 'else {'
    const elseIdx = code.indexOf(elseStr)
    const elseCloseIdx = code.indexOf('\n  }', elseIdx + elseStr.length)
    const elseBlock = code.slice(elseIdx, elseCloseIdx)
    assert.ok(!elseBlock.includes("context.step('post-step'"), 'else should not contain post-step')
    assert.ok(!elseBlock.includes("context.step('after-post'"), 'else should not contain after-post')
  })

  it('nested condition inside then-branch', () => {
    const g: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'c1', kind: 'condition', label: 'outer', condition: 'outer', thenCount: 3 },
        { id: 'outerStep', kind: 'step', label: 'outer-step' },
        { id: 'c2', kind: 'condition', label: 'inner', condition: 'inner', thenCount: 1 },
        { id: 'innerStep', kind: 'step', label: 'inner-step' },
        { id: 'afterInner', kind: 'step', label: 'after-inner' },
        { id: 'outerElse', kind: 'step', label: 'outer-else' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [
        { from: 'c1', to: 'outerStep', label: 'yes' },
        { from: 'c1', to: 'outerElse', label: 'no' },
        { from: 'outerStep', to: 'c2' },
        { from: 'c2', to: 'innerStep', label: 'yes' },
        { from: 'c2', to: 'afterInner', label: 'no' },
      ],
    }
    const code = generateCode(g, { language: 'typescript' })
    assertContains(code, 'if (outer)')
    assertContains(code, 'if (inner)')
    assertContains(code, 'else {')
    assertContains(code, "context.step('inner-step'")
  })
})

// ---------------------------------------------------------------------------
// Config features
// ---------------------------------------------------------------------------

describe('Config features', () => {
  it('stepSemantics: AtMostOncePerRetry in TS', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'idempotent', { stepSemantics: 'AtMostOncePerRetry' })]), { language: 'typescript' })
    assertContains(code, 'StepSemantics.AT_MOST_ONCE_PER_RETRY')
  })

  it('tenantId on invoke in TS', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'invoke', 'inv', { target: 'Fn', tenantId: 'tenant-1' })]), { language: 'typescript' })
    assertContains(code, "tenantId: 'tenant-1'")
  })

  it('timeout on waitForCallback in TS', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'waitForCallback', 'cb', { timeout: 'seconds: 60' })]), { language: 'typescript' })
    assertContains(code, 'seconds: 60')
  })

  it('timeout on createCallback in TS', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'createCallback', 'cb', { timeout: 'seconds: 120' })]), { language: 'typescript' })
    assertContains(code, 'seconds: 120')
  })

  it('retryStrategy on withRetry in TS', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'withRetry', 'retry', { retryStrategy: 'ExponentialBackoff' })]), { language: 'typescript' })
    assertContains(code, 'retryStrategy: ExponentialBackoff')
  })

  it('withRetry with FLAT nesting in TS', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'withRetry', 'retry', { nestingType: 'FLAT' })]), { language: 'typescript' })
    assertContains(code, 'createRetryStrategy')
  })

  it('runInChildContext with FLAT in TS', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'runInChildContext', 'child', { nestingType: 'FLAT' })]), { language: 'typescript' })
    assertContains(code, 'isVirtual: true')
  })
})

describe('Missing imports (regression)', () => {
  it('TypeScript withRetry uses step with retryStrategy', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'withRetry', 'r')]), { language: 'typescript' })
    assertContains(code, 'retryStrategy: createRetryStrategy')
  })

  it('Python imports Duration when wait present', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'wait', 'w')]), { language: 'python' })
    assertContains(code, 'Duration')
  })

  it('Python imports WaitForConditionConfig when needed', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'waitForCondition', 'p')]), { language: 'python' })
    assertContains(code, 'WaitForConditionConfig')
  })

  it('Java imports Duration when wait present', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'wait', 'w')]), { language: 'java' })
    assertContains(code, 'import software.amazon.lambda.durable.Duration;')
  })

  it('Java imports WaitForConditionConfig when needed', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'waitForCondition', 'p')]), { language: 'java' })
    assertContains(code, 'import software.amazon.lambda.durable.WaitForConditionConfig;')
  })

  it('Python imports with_retry when present', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'withRetry', 'r')]), { language: 'python' })
    assertContains(code, 'with_retry')
  })

  it('Python imports ParallelBranch when parallel with branches', () => {
    const g = makeGraph('test', [makeNode('a', 'parallel', 'p', { branches: [makeBranch('b', [])] })])
    const code = generateCode(g, { language: 'python' })
    assertContains(code, 'ParallelBranch')
  })

  it('Python imports create_wait_strategy when waitForCondition present', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'waitForCondition', 'p')]), { language: 'python' })
    assertContains(code, 'create_wait_strategy')
  })

  it('Python does not import Duration when not needed', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 's')]), { language: 'python' })
    assertNotContains(code, 'Duration')
  })
})

// ---------------------------------------------------------------------------
// Variable name deduplication
// ---------------------------------------------------------------------------

describe('Variable name deduplication', () => {
  it('deduplicates same-label nodes in TypeScript', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'step', 'process'),
      makeNode('b', 'step', 'process'),
      makeNode('c', 'step', 'process'),
    ]), { language: 'typescript' })
    const lines = code.split('\n').filter(l => l.includes('const ') && !l.includes('handler'))
    const names = lines.map(l => l.match(/const (\w+)/)?.[1]).filter(Boolean) as string[]
    assert.equal(names.length, 3, `Expected 3 variable names, got ${names.join(', ')}`)
    assert.ok(names.includes('process'), 'Should include base name "process"')
    assert.ok(names.includes('process_2'), 'Should include dedup "process_2"')
    assert.ok(names.includes('process_3'), 'Should include dedup "process_3"')
  })

  it('deduplicates in Python', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'step', 'validate'),
      makeNode('b', 'step', 'validate'),
    ]), { language: 'python' })
    // Python doesn't generate variable names for steps (it's inline)
    const stepCount = (code.match(/context\.step\(func=lambda step_ctx: None, name="validate"/g) ?? []).length
    assert.equal(stepCount, 2, `Expected 2 validate steps, got ${stepCount}`)
  })

  it('handles special characters in label', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'my step! with @#$ chars')]), { language: 'typescript' })
    // Label should be sanitized to a valid variable name
    assertContains(code, 'const my_step_with_chars')
  })

  it('handles label starting with digit', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', '123start')]), { language: 'typescript' })
    assertContains(code, 'const _123start')
  })

  it('handles empty/whitespace label', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', '   ')]), { language: 'typescript' })
    assertContains(code, 'const node')
  })
})

// ---------------------------------------------------------------------------
// Multi-node workflows
// ---------------------------------------------------------------------------

describe('Multi-node workflows', () => {
  it('generates sequential steps', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'step', 'one'),
      makeNode('b', 'step', 'two'),
      makeNode('c', 'step', 'three'),
    ]), { language: 'typescript' })
    assertContains(code, "'one'", "'two'", "'three'")
    assertContains(code, 'return { status')
  })

  it('handles large workflow', () => {
    const nodes: WorkflowNode[] = []
    for (let i = 0; i < 20; i++) {
      nodes.push(makeNode(`n${i}`, 'step', `step-${i}`))
    }
    const code = generateCode(makeGraph('big', nodes), { language: 'typescript' })
    for (let i = 0; i < 20; i++) {
      assertContains(code, `step-${i}`)
    }
  })

  it('generates handler boilerplate for all languages', () => {
    const graph = makeGraph('test', [makeNode('a', 'step', 'do')])
    assertContains(generateCode(graph, { language: 'typescript' }), 'export const handler')
    assertContains(generateCode(graph, { language: 'python' }), '@durable_execution')
    assertContains(generateCode(graph, { language: 'java' }), 'extends DurableHandler')
    assertContains(generateCode(graph, { language: 'csharp' }), 'DurableFunction.WrapAsync')
  })
})

// ---------------------------------------------------------------------------
// Language-specific edge cases
// ---------------------------------------------------------------------------

describe('Language-specific', () => {
  it('Python uses snake_case and correct API order', () => {
    const graph = makeGraph('test', [
      makeNode('a', 'waitForCallback', 'my-callback'),
      makeNode('b', 'runInChildContext', 'my-child'),
      makeNode('c', 'withRetry', 'my-retry'),
    ])
    const code = generateCode(graph, { language: 'python' })
    assertContains(code, 'context.wait_for_callback(submitter=lambda callback_id, callback_ctx: None')
    assertContains(code, 'context.run_in_child_context(func=lambda child_ctx: None')
    assertContains(code, 'with_retry(context=context, func=lambda retry_ctx, attempt: None')
  })

  it('C# withRetry wraps in StepAsync', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'withRetry', 'retry')]), { language: 'csharp' })
    assertContains(code, 'StepConfig')
    assertContains(code, 'RetryStrategy')
    assertContains(code, '// withRetry: wrap')
  })

  it('C# executable model bootstrap', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'do')]), { language: 'csharp' })
    assertContains(code, 'public static async Task Main')
    assertContains(code, 'LambdaBootstrap')
    assertContains(code, 'HandlerWrapper')
  })

  it('Java parallel uses .get()', () => {
    const g = makeGraph('test', [makeNode('a', 'parallel', 'par', {
      branches: [makeBranch('b1', [makeNode('b1n', 'step', 'do')])],
    })])
    const code = generateCode(g, { language: 'java' })
    assertContains(code, '.get();')
  })

  it('generates no code for start/end nodes', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'only')]), { language: 'typescript' })
    assertNotContains(code, 'node_start')
    assertNotContains(code, 'node_end')
  })

  it('single-node workflow', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'single')]), { language: 'typescript' })
    assertContains(code, "context.step('single'")
    assertContains(code, 'return { status')
  })

  it('workflow name used for class in Java/C#', () => {
    const graph = makeGraph('order-processor', [makeNode('a', 'step', 'do')])
    assertContains(generateCode(graph, { language: 'java' }), 'class OrderProcessor')
    assertContains(generateCode(graph, { language: 'csharp' }), 'namespace OrderProcessor')
  })

  it('default class name for empty/unconventional workflow names', () => {
    const graph = makeGraph('!!!', [makeNode('a', 'step', 'do')])
    assertContains(generateCode(graph, { language: 'java' }), 'class WorkflowHandler')
  })
})

// ---------------------------------------------------------------------------
// Examples (integration tests with actual file parsing)
// ---------------------------------------------------------------------------

describe('generateCode (from examples)', () => {
  it('generates TypeScript from order workflow', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    assert.ok(code.includes("export const handler = withDurableExecution"), 'Should generate handler')
    assert.ok(code.includes("'validate-order'"), 'Should include step names')
    assert.ok(code.includes("context.parallel"), 'Should generate parallel')

    assert.ok(!code.includes('node_start'), 'Should not contain meta node IDs')
    assert.ok(!code.includes('node_end'), 'Should not contain meta node IDs')
  })

  it('generates if/else from condition node', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    assert.ok(code.includes('if ('), 'Should generate if-statement')
    assert.ok(code.includes('else'), 'Should generate else-branch')
  })

  it('generates Python from order processor', () => {
    const graph = parseFile(resolve(examplesDir, 'order_processor.py'))
    const code = generateCode(graph, { language: 'python' })

    assert.ok(code.includes('@durable_execution'), 'Should generate decorator')
    assert.ok(code.includes('def handler'), 'Should generate handler function')
    assert.ok(code.includes('"validate_order"'), 'Should include step names')
    assert.ok(code.includes('context.step'), 'Should generate steps')
  })

  it('generates Java from OrderProcessor', () => {
    const graph = parseFile(resolve(examplesDir, 'OrderProcessor.java'))
    const code = generateCode(graph, { language: 'java' })

    assert.ok(code.includes('extends DurableHandler'), 'Should generate class')
    assert.ok(code.includes('handleRequest'), 'Should generate method')
    assert.ok(code.includes('"validate-order"'), 'Should include step names')
    assert.ok(code.includes('ctx.step'), 'Should generate steps')
  })

  it('generates ts code without start/end in variable names', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    const nodeIds = graph.nodes.filter((n) => n.kind !== 'start' && n.kind !== 'end').map((n) => n.id)
    for (const id of nodeIds) {
      assert.ok(!code.includes(id), `Should not include raw node ID ${id}`)
    }
  })

  it('includes TODO comments for each primitive', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))
    const code = generateCode(graph, { language: 'typescript' })

    const todos = (code.match(/\/\/ TODO/g) ?? []).length
    assert.ok(todos >= 3, `Expected at least 3 TODO comments, got ${todos}`)
  })

  it('generates C# from OrderWorkflow.cs', () => {
    const graph = parseFile(resolve(examplesDir, 'OrderWorkflow.cs'))
    const code = generateCode(graph, { language: 'csharp' })

    assertContains(code, 'ctx.StepAsync', 'ctx.ParallelAsync', 'ctx.WaitAsync', 'ctx.WaitForCallbackAsync')
  })

  it('generates all languages from config example', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow-config.ts'))

    const ts = generateCode(graph, { language: 'typescript' })
    assertContains(ts, 'context.step', 'context.parallel', 'context.map', 'context.invoke')
    assertContains(ts, 'runInChildContext', 'createRetryStrategy')

    const py = generateCode(graph, { language: 'python' })
    assertContains(py, '@durable_execution', 'def handler')

    const java = generateCode(graph, { language: 'java' })
    assertContains(java, 'extends DurableHandler', 'handleRequest')

    const cs = generateCode(graph, { language: 'csharp' })
    assertContains(cs, 'DurableFunction.WrapAsync', 'IDurableContext')
  })
})
