/**
 * Example durable function with config-level features:
 * - stepSemantics
 * - nestingType on parallel, map, runInChildContext
 * - completionConfig on parallel, map
 * - tenantId on invoke
 */

import {
  withDurableExecution,
  withRetry,
  defaultSerdes,
  NestingType,
  CompletionConfig,
  StepSemantics,
  type DurableContext,
} from '@aws/durable-execution-sdk-js'

interface OrderEvent {
  orderId: string
  items: string[]
  total: number
  requireApproval?: boolean
}

export const handler = withDurableExecution(async (
  event: OrderEvent,
  context: DurableContext
): Promise<Record<string, unknown>> => {

  // Step with AtMostOncePerRetry semantics
  const order = await context.step('validate-order', async () => {
    return { ...event, validated: true, timestamp: new Date().toISOString() }
  }, { semantics: StepSemantics.AtMostOncePerRetry })

  // Parallel with FLAT nesting and firstSuccessful completion
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
  ], {
    nestingType: NestingType.FLAT,
    completionConfig: CompletionConfig.firstSuccessful(),
  })

  // Map with FLAT nesting and allCompleted completion
  const processed = await context.map('batch-process', event.items,
    async (ctx, item, index) => {
      return await ctx.step(`process-${item}`, async () => {
        return { item, processed: true }
      })
    },
    {
      nestingType: NestingType.FLAT,
      completionConfig: CompletionConfig.allCompleted(),
    },
  )

  // Invoke with tenant isolation
  const shipment = await context.invoke('fulfillment-service', 'fulfillment-service',
    {
      orderId: event.orderId,
    },
    {
      tenantId: 'tenant-abc-123',
    },
  )

  // Run in child context with FLAT nesting
  const childResult = await context.runInChildContext('isolated-logic',
    async (childCtx) => {
      return await childCtx.step('inner-step', async () => {
        return { done: true }
      })
    },
    {
      isVirtual: true,
    },
  )

  // withRetry using FLAT nesting (standalone function)
  await context.step('prepare-fulfillment', async () => ({ ready: true }))

  const fulfilled = await withRetry(context, 'retry-fulfillment',
    async (ctx, attempt) => {
      return await ctx.step(`fulfillment-attempt-${attempt}`, async () => {
        return { attempted: true }
      })
    },
    {
      retryStrategy: createRetryStrategy({ maxAttempts: 3 }),
      virtualContext: true,
    },
  ) as unknown

  await context.step('send-confirmation', async () => {
    return { sent: true }
  })

  return { status: 'completed', orderId: event.orderId }
})

function createRetryStrategy(_config: Record<string, unknown>) {
  return () => ({ shouldRetry: false })
}
