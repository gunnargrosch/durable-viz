package com.example.orders;

import com.example.otel.OtelPlugins;
import software.amazon.lambda.durable.DurableConfig;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;

public class Handler extends DurableHandler<Order, OrderResult> {

    public static DurableConfig config() {
        return DurableConfig.builder().withPlugins(OtelPlugins.createPluginFactory()).build();
    }

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        ctx.step("validate-order", Order.class, stepCtx -> order);
        return new OrderResult();
    }
}
