import { withDurableExecution, type DurableContext } from '@aws/durable-execution-sdk-js'
import { createOtelPluginFactory } from '@aws/durable-execution-sdk-js-otel'

export const handler = withDurableExecution(
  async (event: { orderId: string }, context: DurableContext) => {
    const order = await context.step('load-order', async () => ({ id: event.orderId }))
    const approval = await context.waitForCallback('manager-approval', async () => {})
    await context.step('publish-order', async () => ({ id: order.id, approval }))
    return { status: 'published' }
  },
  {
    plugins: [
      createOtelPluginFactory({ mode: 'invocation', workflowSpanName: 'OrderWorkflow' }),
    ],
  },
)
