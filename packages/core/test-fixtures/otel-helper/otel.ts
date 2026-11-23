import {
  createExecutionOtelPluginFactory,
  createInvocationOtelPluginFactory,
} from '@aws/durable-execution-sdk-js-otel'

export function loadOtelPlugins() {
  const mode = process.env.OTEL_PLUGIN
  if (!mode) return []
  if (mode === 'execution') return [createExecutionOtelPluginFactory()]
  if (mode === 'invocation') return [createInvocationOtelPluginFactory()]
  throw new Error(`Unknown OTEL_PLUGIN value: "${mode}"`)
}
