import { withDurableExecution, withRetry } from '@aws/durable-execution-sdk-js'

export const handler = withDurableExecution(async (event: { value: number }, context) => {
  const child = await context.runInChildContext('nested-child', async (childCtx) => {
    await childCtx.step('nested-step', async () => event.value)
    await childCtx.wait('nested-wait', { seconds: 1 })
    return event.value
  })

  const retried = await withRetry(context, 'nested-retry', async (retryCtx, attempt) => {
    await retryCtx.step('retry-step', async () => event.value + attempt)
    return attempt
  })

  return { child, retried }
})
