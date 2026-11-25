package com.example.orders;

import java.time.Duration;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;

public class NestedJavaOperations extends DurableHandler<Order, OrderResult> {

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        var child = ctx.runInChildContext("nested-child", OrderResult.class, childCtx -> {
            childCtx.step("child-step", Order.class, stepCtx -> order);
            childCtx.wait("child-wait", Duration.ofSeconds(1));
            return new OrderResult();
        });

        var retried = ctx.withRetry("nested-retry", (attempt, retryCtx) -> {
            retryCtx.step("retry-step", Order.class, stepCtx -> order);
            return new OrderResult();
        });

        return child;
    }
}
