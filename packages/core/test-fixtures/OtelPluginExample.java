package com.example.orders;

import software.amazon.lambda.durable.DurableConfig;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;
import software.amazon.lambda.durable.otel.OtelPlugin;

public class OtelPluginExample extends DurableHandler<Order, OrderResult> {

    public static DurableConfig config() {
        return DurableConfig.builder()
            .withPlugins(OtelPlugin.factory(OtelPlugin.Mode.INVOCATION))
            .build();
    }

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        ctx.step("validate-order", Order.class, stepCtx -> order);
        return new OrderResult();
    }
}
