import { withDurableExecution, type DurableContext } from '@aws/durable-execution-sdk-js'

export const handler = withDurableExecution(async (event: { batches: string[][] }, context: DurableContext) => {
  const names = await context.step('load', async () => ['a', 'b'])

  for (const name of await context.step('list', async () => names)) {
    for (const batch of event.batches) {
      await context.step('process', async () => batch)
    }
    await context.step('summarize', async () => name)
  }
})
