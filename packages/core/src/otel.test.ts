import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { parseFile } from './parser.js'
import { renderMermaid } from './renderers/mermaid.js'
import { detectJavaOtel, detectPythonOtel, detectTypeScriptOtel, otelModeLabel, renderOtelTree } from './otel.js'
import type { WorkflowGraph } from './graph.js'

const examplesDir = resolve(import.meta.dirname, '../../..', 'examples')
const fixturesDir = resolve(import.meta.dirname, '..', 'test-fixtures')

describe('OpenTelemetry detection', () => {
  it('detects the TypeScript plugin factory and its mode', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow_otel.ts'))

    assert.equal(graph.otel?.mode, 'invocation')
    assert.equal(graph.otel?.workflowSpanName, 'OrderWorkflow')
    assert.equal(graph.otel?.source, 'code')
    assert.match(graph.otel?.registration ?? '', /createOtelPluginFactory/)
    assert.equal(graph.otel?.sourceLine, 12)
  })

  it('detects the Python decorator plugin factory and its mode', () => {
    const graph = parseFile(resolve(examplesDir, 'order_processor_otel.py'))

    assert.equal(graph.otel?.mode, 'invocation')
    assert.equal(graph.otel?.workflowSpanName, 'Workflow')
    assert.equal(graph.otel?.source, 'code')
    assert.match(graph.otel?.registration ?? '', /create_otel_plugin_factory/)
    assert.equal(graph.otel?.sourceLine, 5)
  })

  it('detects a helper that selects the plugin from the environment', () => {
    const otel = detectTypeScriptOtel(`
      withDurableExecution(handler, { plugins: loadOtelPlugins() })
    `)

    assert.equal(otel?.mode, 'custom')
    assert.equal(otel?.registration, 'loadOtelPlugins()')
  })

  it('detects the Java unified and view-specific factories', () => {
    assert.equal(
      detectJavaOtel('DurableConfig.builder().withPlugins(OtelPlugin.factory()).build()')?.mode,
      'execution',
    )
    assert.equal(
      detectJavaOtel('DurableConfig.builder().withPlugins(OtelPlugin.factory(OtelPlugin.Mode.INVOCATION)).build()')?.mode,
      'invocation',
    )
    assert.equal(
      detectJavaOtel('DurableConfig.builder().withPlugins(InvocationOtelPlugin.factory()).build()')?.mode,
      'invocation',
    )
    assert.equal(
      detectJavaOtel('DurableConfig.builder().withPlugins(createPluginFactory()).build()')?.mode,
      undefined,
    )
  })

  it('follows a relative helper and reports its runtime modes', () => {
    const graph = parseFile(resolve(fixturesDir, 'otel-helper/handler.ts'))

    assert.equal(graph.otel?.mode, 'custom')
    assert.deepEqual(graph.otel?.modes, ['execution', 'invocation'])
    assert.equal(graph.otel?.environmentVariable, 'OTEL_PLUGIN')
    assert.equal(graph.otel?.registration, 'loadOtelPlugins()')
    assert.equal(otelModeLabel(graph.otel!), 'env')

    const tree = renderOtelTree(graph)
    assert.ok(tree)
    assert.match(tree, /selected by OTEL_PLUGIN \(execution or invocation\)/)
  })

  it('follows a Python helper imported from a relative module', () => {
    const graph = parseFile(resolve(fixturesDir, 'otel-helper-python/handler.py'))

    assert.equal(graph.otel?.mode, 'custom')
    assert.deepEqual(graph.otel?.modes, ['execution', 'invocation'])
    assert.equal(graph.otel?.environmentVariable, 'OTEL_PLUGIN')
    assert.equal(detectPythonOtel('@durable_execution(plugins=[load_otel_plugins()])')?.mode, 'custom')

    const tree = renderOtelTree(graph)
    assert.ok(tree)
    assert.match(tree, /selected by OTEL_PLUGIN \(execution or invocation\)/)
  })

  it('follows a Java helper method in the same file', () => {
    const graph = parseFile(resolve(fixturesDir, 'OtelPluginHelperExample.java'))

    assert.equal(graph.otel?.mode, 'custom')
    assert.deepEqual(graph.otel?.modes, ['execution', 'invocation'])
    assert.equal(graph.otel?.environmentVariable, 'OTEL_PLUGIN_MODE')
    assert.equal(graph.otel?.registration, 'createPluginFactory()')
  })

  it('follows a Java helper imported from another class', () => {
    const graph = parseFile(resolve(fixturesDir, 'otel-helper-java/src/main/java/com/example/orders/Handler.java'))

    assert.equal(graph.otel?.mode, 'custom')
    assert.deepEqual(graph.otel?.modes, ['execution', 'invocation'])
    assert.equal(graph.otel?.environmentVariable, 'OTEL_PLUGIN_MODE')
  })

  it('leaves graphs without a plugin untouched', () => {
    const graph = parseFile(resolve(examplesDir, 'order-workflow.ts'))

    assert.equal(graph.otel, undefined)
    assert.equal(renderOtelTree(graph), undefined)
    assert.ok(!renderMermaid(graph).includes('span load-order'))
  })

  it('renders the expected span tree', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow_otel.ts'))
    const tree = renderOtelTree(graph)

    assert.ok(tree)
    assert.match(tree, /OTel plugin: invocation mode/)
    assert.match(tree, /Workflow span: "OrderWorkflow"/)
    assert.match(tree, /Invocation/)
    assert.match(tree, /step "load-order"/)
    assert.match(tree, /attempt "load-order attempt N"/)
    assert.match(tree, /waitForCallback "manager-approval"/)
  })

  it('adds span names and the plugin mode to the Mermaid output', () => {
    const graph = parseFile(resolve(examplesDir, 'order_workflow_otel.ts'))
    const mermaid = renderMermaid(graph)

    assert.match(mermaid, /%% OTel plugin: invocation mode, Workflow span "OrderWorkflow"/)
    assert.match(mermaid, /span load-order/)
    assert.match(mermaid, /span manager-approval/)
  })

  it('warns about unnamed and duplicate operation names', () => {
    const graph: WorkflowGraph = {
      name: 'test',
      otel: { mode: 'execution', workflowSpanName: 'Workflow', source: 'code' },
      nodes: [
        { id: 'node_start', kind: 'start', label: 'Start' },
        { id: 'a', kind: 'step', label: 'step' },
        { id: 'b', kind: 'step', label: 'load' },
        { id: 'c', kind: 'step', label: 'load' },
        { id: 'node_end', kind: 'end', label: 'End' },
      ],
      edges: [],
    }

    const tree = renderOtelTree(graph)
    assert.ok(tree)
    assert.match(tree, /\(unnamed, span uses the operation type\)/)
    assert.match(tree, /"load" appears 2 times/)
  })
})
