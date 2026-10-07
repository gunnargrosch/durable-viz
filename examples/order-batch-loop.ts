/**
 * Example durable function — batch order processing with loops.
 *
 * Run: npx durable-viz examples/order-batch-loop.ts --open
 */

import {
  withDurableExecution,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'

interface BatchEvent {
  orders: { id: string; total: number }[]
}

export const handler = withDurableExecution(async (
  event: BatchEvent,
  context: DurableContext,
) => {
  await context.step('load-batch', async () => ({ count: event.orders.length }))

  // Runs once per order. Each iteration is a separate set of checkpointed steps.
  for (const order of event.orders) {
    await context.step('validate-order', async () => ({ id: order.id, valid: true }))

    if (order.total > 10000) {
      await context.waitForCallback('manager-approval', async (callbackId) => {
        console.log(`Approval needed: ${callbackId}`)
      })
    }

    await context.step('charge-order', async () => ({ id: order.id, charged: true }))
  }

  // Poll up to three times, waiting between attempts.
  for (let attempt = 0; attempt < 3; attempt++) {
    await context.wait('wait-for-settlement', { seconds: 30 })
    await context.step('check-settlement', async () => ({ settled: false }))
  }

  return context.step('send-summary', async () => ({ status: 'completed' }))
})
