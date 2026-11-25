package com.example.orders;

import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;
import software.amazon.lambda.durable.config.Duration;

public class DurableAsyncOperations extends DurableHandler<Order, OrderResult> {

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        var step = ctx.stepAsync("async-step", Order.class, stepCtx -> order);
        ctx.waitAsync("async-wait", Duration.ofSeconds(1));
        var invoked = ctx.invokeAsync("async-invoke", "target", order, Order.class);
        var child = ctx.runInChildContextAsync("async-child", Order.class, childCtx -> order);
        var mapped = ctx.mapAsync("async-map", java.util.List.of(order), Order.class, (childCtx, item, idx, items, token) -> item);
        var callback = ctx.waitForCallbackAsync("async-callback", Order.class, (callbackId, stepCtx) -> {});
        var condition = ctx.waitForConditionAsync("async-condition", Order.class, null, null);
        var retried = ctx.withRetryAsync("async-retry", (attempt, retryCtx) -> order);
        return new OrderResult();
    }
}
