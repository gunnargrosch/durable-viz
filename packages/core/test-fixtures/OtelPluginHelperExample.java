package com.example.orders;

import software.amazon.lambda.durable.DurableConfig;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;
import software.amazon.lambda.durable.otel.ExecutionOtelPlugin;
import software.amazon.lambda.durable.otel.InvocationOtelPlugin;
import software.amazon.lambda.durable.plugin.DurableExecutionPluginFactory;

public class OtelPluginHelperExample extends DurableHandler<Order, OrderResult> {

    private DurableExecutionPluginFactory createPluginFactory() {
        return "execution".equals(System.getenv("OTEL_PLUGIN_MODE"))
            ? ExecutionOtelPlugin.factory()
            : InvocationOtelPlugin.factory();
    }

    public static DurableConfig config() {
        return DurableConfig.builder().withPlugins(createPluginFactory()).build();
    }

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        ctx.step("validate-order", Order.class, stepCtx -> order);
        return new OrderResult();
    }
}
