/**
 * Example durable function: a short workflow that fans out into parallel checks.
 *
 * Run: npx durable-viz examples/order-parallel.ts --open
 */

import {
  withDurableExecution,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'

interface OrderEvent {
  orderId: string
  items: string[]
  total: number
}

export const handler = withDurableExecution(async (
  event: OrderEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {

  const order = await context.step('validate-order', async () => {
    return { ...event, validated: true }
  })

  const checks = await context.parallel('run-checks', [
    {
      name: 'check-inventory',
      func: async (ctx) => ctx.invoke('check-inventory', 'InventoryFunction', { items: order.items }),
    },
    {
      name: 'reserve-payment',
      func: async (ctx) => ctx.invoke('reserve-payment', 'PaymentFunction', { total: order.total }),
    },
    {
      name: 'screen-fraud',
      func: async (ctx) => ctx.invoke('screen-fraud', 'FraudFunction', { orderId: order.orderId }),
    },
    {
      name: 'quote-shipping',
      func: async (ctx) => ctx.invoke('quote-shipping', 'ShippingFunction', { items: order.items }),
    },
  ])

  const confirmation = await context.step('confirm-order', async () => {
    return { confirmed: true, results: checks.succeeded() }
  })

  return { status: 'completed', orderId: event.orderId, confirmation }
})
