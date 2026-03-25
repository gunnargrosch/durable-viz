/**
 * Example durable function — order processing workflow.
 *
 * Run: npx durable-viz examples/order-workflow.ts --open
 */

import {
  withDurableExecution,
  defaultSerdes,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'

interface OrderEvent {
  orderId: string
  items: string[]
  total: number
  requireApproval?: boolean
}

interface ApprovalResult {
  approved: boolean
  notes?: string
}

export const handler = withDurableExecution(async (
  event: OrderEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {

  // Validate and enrich the order
  const order = await context.step('validate-order', async () => {
    return { ...event, validated: true, timestamp: new Date().toISOString() }
  })

  // Check inventory and reserve payment in parallel
  const results = await context.parallel('prepare-order', [
    {
      name: 'check-inventory',
      func: async (ctx) => {
        return await ctx.invoke('check-inventory', 'InventoryFunction', {
          items: order.items,
        })
      },
    },
    {
      name: 'reserve-payment',
      func: async (ctx) => {
        return await ctx.invoke('reserve-payment', 'PaymentFunction', {
          total: order.total,
        })
      },
    },
  ])

  // Synthesize preparation results
  const preparation = await context.step('review-results', async () => {
    return { ready: true, results: results.succeeded() }
  })

  // High-value orders need manager approval
  if (event.total > 5000) {
    const approval = await context.waitForCallback<ApprovalResult>(
      'manager-approval',
      async (callbackId) => {
        context.logger.info('Awaiting approval', { callbackId, orderId: event.orderId })
      },
      { timeout: { hours: 24 }, serdes: defaultSerdes }
    )

    if (!approval.approved) {
      return { status: 'rejected', orderId: event.orderId, notes: approval.notes }
    }
  }

  // Fulfill the order
  const shipment = await context.step('fulfill-order', async () => {
    return { shipped: true, trackingId: `TRK-${event.orderId}` }
  })

  return { status: 'completed', orderId: event.orderId, shipment }
})
