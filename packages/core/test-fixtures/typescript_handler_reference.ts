import { withDurableExecution, type DurableExecutionHandler } from '@aws/durable-execution-sdk-js'

const durableHandler: DurableExecutionHandler = async (event: { value: string }, context) => {
  const step = await context.step('reference-step', async () => event.value)
  const [promise, callbackId] = await context.createCallback('reference-callback')
  await promise
  return { step, callbackId }
}

export const handler = withDurableExecution(durableHandler)
