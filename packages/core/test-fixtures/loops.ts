import { withDurableExecution, type DurableContext } from '@aws/durable-execution-sdk-js'

export const handler = withDurableExecution(async (event: { orders: string[] }, context: DurableContext) => {
  await context.step('start', async () => ({ ok: true }))

  for (const order of event.orders) {
    await context.step('validate', async () => order)
    if (order.startsWith('vip')) {
      await context.step('vip-perk', async () => order)
    }
    await context.step('charge', async () => order)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await context.step(`retry-${attempt}`, async () => attempt)
    await context.wait('backoff', { seconds: 5 })
  }

  while (true) {
    const done = await context.step('poll', async () => true)
    if (done) break
  }

  for (const region of ['us', 'eu']) {
    await context.parallel('fan out', [
      { name: 'a', func: async (ctx: DurableContext) => ctx.invoke('call-a', 'fn-a', {}) },
    ])
  }

  for (const skipped of event.orders) {
    console.log(skipped)
  }

  await context.step('finish', async () => ({ ok: true }))
})
