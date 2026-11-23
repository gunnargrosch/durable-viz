import { withDurableExecution } from '@aws/durable-execution-sdk-js'
import { loadOtelPlugins } from './otel.js'

export const handler = withDurableExecution(
  async (event: { orderId: string }, context: any) => {
    return context.step('load-order', async () => event.orderId)
  },
  { plugins: loadOtelPlugins() },
)
