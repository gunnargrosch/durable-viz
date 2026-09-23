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
  ['rust', 'ctx.step(|_| async { Ok(()) }).name("my-step")', 'ctx.invoke::<serde_json::Value, _>("MyFunc"', 'ctx.wait(Duration::from_secs(1)).name("my-wait")'],
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
// Rust-specific primitives
// ---------------------------------------------------------------------------

describe('Rust: combinators and modifiers', () => {
  it('emits the handler + tokio::main + durable::run entry point', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'do-work')]), { language: 'rust' })
    assertContains(code, 'use aws_durable_execution_sdk as durable;')
    assertContains(code, 'async fn handler(')
    assertContains(code, '#[tokio::main]')
    assertContains(code, 'durable::run(handler).await')
  })

  it('promiseAll maps to try_join_all', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseAll', 'all-tasks')]), { language: 'rust' })
    assertContains(code, 'ctx.try_join_all([', 'all-tasks')
  })

  it('promiseAny maps to select_ok', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseAny', 'any-task')]), { language: 'rust' })
    assertContains(code, 'ctx.select_ok([', 'any-task')
  })

  it('promiseRace maps to race', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseRace', 'race-task')]), { language: 'rust' })
    assertContains(code, 'ctx.race([', 'race-task')
  })

  it('promiseAllSettled maps to join_all', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'promiseAllSettled', 'settled-tasks')]), { language: 'rust' })
    assertContains(code, 'ctx.join_all([', 'settled-tasks')
  })

  it('emits Branch::new for parallel branches', () => {
    const graph = makeGraph('test', [makeNode('a', 'parallel', 'fanout', {
      branches: [makeBranch('left', [makeNode('b', 'step', 'left')]), makeBranch('right', [makeNode('c', 'step', 'right')])],
    })])
    const code = generateCode(graph, { language: 'rust' })
    assertContains(code, 'Branch::new("left"', 'Branch::new("right"', 'ctx.parallel(vec![')
  })

  it('emits nesting, completion, and max_concurrency modifiers', () => {
    const node = makeNode('a', 'parallel', 'fanout', { nestingType: 'FLAT', completionConfig: 'minSuccessful:1', maxConcurrency: 3 })
    const code = generateCode(makeGraph('test', [node]), { language: 'rust' })
    assertContains(code, '.nesting(NestingMode::Flat)')
    assertContains(code, '.completion(CompletionConfig::builder()')
    assertContains(code, '.max_concurrency(3)')
  })

  it('emits step semantics and tenant id', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'step', 'idem', { stepSemantics: 'AtMostOncePerRetry' }),
      makeNode('b', 'invoke', 'ten', { target: 'MyFunc', tenantId: 'tenant-1' }),
    ]), { language: 'rust' })
    assertContains(code, '.semantics(durable::StepSemantics::AtMostOncePerRetry)')
    assertContains(code, '.tenant_id("tenant-1")')
  })

  it('imports Duration when a wait is present and omits it otherwise', () => {
    const withWait = generateCode(makeGraph('test', [makeNode('a', 'wait', 'w')]), { language: 'rust' })
    assertContains(withWait, 'use std::time::Duration;')

    const withoutWait = generateCode(makeGraph('test', [makeNode('a', 'step', 's')]), { language: 'rust' })
    assertNotContains(withoutWait, 'use std::time::Duration;')
  })
})

// ---------------------------------------------------------------------------
// maxConcurrency emission
// ---------------------------------------------------------------------------

describe('maxConcurrency in generated code', () => {
  it('typescript parallel/map', () => {
    const node = makeNode('a', 'parallel', 'fanout', {
      maxConcurrency: 5,
      branches: [makeBranch('left', [makeNode('b', 'step', 'left')])],
    })
    const code = generateCode(makeGraph('test', [node]), { language: 'typescript' })
    assertContains(code, 'maxConcurrency: 5')
  })

  it('csharp parallel/map', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'parallel', 'fanout', { maxConcurrency: 5 })]), { language: 'csharp' })
    assertContains(code, 'MaxConcurrency = 5')
  })

  it('rust parallel/map', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'map', 'm', { maxConcurrency: 5 })]), { language: 'rust' })
    assertContains(code, '.max_concurrency(5)')
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

  it('C# stepSemantics in StepConfig', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'idempotent', { stepSemantics: 'AtMostOncePerRetry' })]), { language: 'csharp' })
    assertContains(code, 'StepSemantics.AtMostOncePerRetry')
  })

  it('C# tenantId in InvokeConfig', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'invoke', 'tenant-invoke', { tenantId: 'tenant-abc-123' })]), { language: 'csharp' })
    assertContains(code, 'InvokeConfig')
    assertContains(code, 'tenant-abc-123')
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

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

describe('Go code generation', () => {
  it('emits a package, durable import, handler, and Start entry point', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 'do-work')]), { language: 'go' })
    assertContains(
      code,
      'package main',
      '"github.com/aws/aws-durable-execution-sdk-go/durable"',
      'func handler(ctx durable.Context, event any) (any, error) {',
      'durable.Start(handler)',
    )
  })

  it('generates basic primitives', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'step', 'my-step'),
      makeNode('b', 'invoke', 'my-invoke', { target: 'MyFunc' }),
      makeNode('c', 'wait', 'my-wait'),
    ]), { language: 'go' })
    assertContains(
      code,
      'durable.Step(ctx, "my-step"',
      'durable.Invoke[any, any](ctx, "my-invoke", "MyFunc"',
      'durable.Wait(ctx, "my-wait", 30*time.Second)',
      '"time"',
    )
  })

  it('generates callback and condition primitives', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'waitForCallback', 'my-callback'),
      makeNode('b', 'createCallback', 'create-cb'),
      makeNode('c', 'waitForCondition', 'poll-status'),
    ]), { language: 'go' })
    assertContains(
      code,
      'durable.WaitForCallback[any](ctx, "my-callback"',
      'durable.CreateCallback[any](ctx, "create-cb"',
      'durable.WaitForCondition[any](ctx, "poll-status"',
      'durable.ConditionConfig[any]{}',
    )
  })

  it('generates child context, retry, and tenant config', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'runInChildContext', 'child-work', { nestingType: 'FLAT' }),
      makeNode('b', 'withRetry', 'retry-op'),
      makeNode('c', 'invoke', 'tenant-invoke', { target: 'Fn', tenantId: 'tenant-9' }),
    ]), { language: 'go' })
    assertContains(
      code,
      'durable.RunInChildContext[any](ctx, "child-work"',
      'durable.WithChildVirtual()',
      'durable.Retry[any](ctx, "retry-op"',
      'durable.ExponentialBackoff()',
      'durable.WithTenantID("tenant-9")',
    )
  })

  it('emits step semantics', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'step', 's', { stepSemantics: 'AtMostOncePerRetry' })]), { language: 'go' })
    assertContains(code, 'durable.WithSemantics(durable.AtMostOncePerRetry)')
  })

  it('emits parallel branches with Name/Func', () => {
    const node = makeNode('a', 'parallel', 'fanout', {
      branches: [makeBranch('left', [makeNode('b', 'step', 'left')]), makeBranch('right', [makeNode('c', 'step', 'right')])],
    })
    const code = generateCode(makeGraph('test', [node]), { language: 'go' })
    assertContains(code, 'durable.Parallel[any](ctx, "fanout", []durable.Branch[any]{', 'Name: "left"', 'Name: "right"')
  })

  it('emits map concurrency and completion config with the aws import', () => {
    const node = makeNode('a', 'map', 'm', { maxConcurrency: 5, completionConfig: 'toleratedFailures:2' })
    const code = generateCode(makeGraph('test', [node]), { language: 'go' })
    assertContains(code, 'durable.Map[any, any](ctx, "m"', 'durable.WithMaxConcurrency(5)', 'durable.WithCompletion(durable.CompletionConfig{ToleratedFailureCount: aws.Int(2)})', '"github.com/aws/aws-sdk-go-v2/aws"')
  })

  it('omits the aws import when no completion config needs it', () => {
    const code = generateCode(makeGraph('test', [makeNode('a', 'map', 'm', { maxConcurrency: 5 })]), { language: 'go' })
    assertNotContains(code, 'aws-sdk-go-v2/aws')
  })

  it('generates promise combinators', () => {
    const code = generateCode(makeGraph('test', [
      makeNode('a', 'promiseAll', 'all-ops'),
      makeNode('b', 'promiseAny', 'any-ops'),
      makeNode('c', 'promiseRace', 'race-ops'),
      makeNode('d', 'promiseAllSettled', 'settled-ops'),
    ]), { language: 'go' })
    assertContains(
      code,
      'durable.All[any](ctx, "all-ops"',
      'durable.Any[any](ctx, "any-ops"',
      'durable.Race[any](ctx, "race-ops"',
      'durable.AllSettled[any](ctx, "settled-ops"',
    )
  })

  it('generates Go from the order_workflow example', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow.go'))
    const code = generateCode(graph, { language: 'go' })

    assertContains(code, 'package main', 'durable.Start(handler)', 'durable.Step(ctx, "validate-order"', 'durable.Parallel[any](ctx, "prepare-shipment"', 'Name: "generate-label"')
  })

  it('generates Go from the order_workflow_config example', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow_config.go'))
    const code = generateCode(graph, { language: 'go' })

    assertContains(code, 'durable.WithSemantics(durable.AtMostOncePerRetry)', 'durable.WithTenantID("tenant-001")', 'durable.WaitForCondition[any]')
  })
})
