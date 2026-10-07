package com.example.orders;

import software.amazon.lambda.durable.DurableHandler;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.config.Duration;

/**
 * Example durable function: batch order processing with loops.
 *
 * Run: npx durable-viz examples/OrderBatchLoop.java --open
 */
public class OrderBatchLoop extends DurableHandler<Batch, BatchResult> {

    @Override
    protected BatchResult handleRequest(Batch batch, DurableContext ctx) {
        ctx.step("load-batch", Batch.class, stepCtx -> batchService.load(batch));

        // Runs once per order. Each iteration is a separate set of checkpointed steps.
        for (Order order : batch.getOrders()) {
            ctx.step("validate-order", Order.class, stepCtx -> orderService.validate(order));

            if (order.getTotal() > 10000) {
                ctx.waitForCallback("manager-approval", callbackId -> notifyManager(callbackId, order));
            }

            ctx.step("charge-order", Payment.class, stepCtx -> paymentService.charge(order));
        }

        // Poll up to three times, waiting between attempts.
        for (int attempt = 0; attempt < 3; attempt++) {
            ctx.wait("wait-for-settlement", Duration.ofSeconds(30));
            ctx.step("check-settlement", Boolean.class, stepCtx -> settlementService.check(batch));
        }

        return ctx.step("send-summary", BatchResult.class, stepCtx -> summaryService.send(batch));
    }
}
