package com.example.orders;

import software.amazon.lambda.durable.DurableConfig;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;
import software.amazon.lambda.durable.config.Duration;
import software.amazon.lambda.durable.otel.OtelPlugin;

/**
 * Example durable function with the OpenTelemetry plugin in invocation mode.
 *
 * Run: npx durable-viz examples/OrderProcessorOtel.java --open
 */
public class OrderProcessorOtel extends DurableHandler<Order, OrderResult> {

    public static DurableConfig config() {
        return DurableConfig.builder()
            .withPlugins(OtelPlugin.factory(OtelPlugin.Mode.INVOCATION))
            .build();
    }

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        var validated = ctx.step("validate-order", Order.class, stepCtx -> order);
        ctx.wait("shipping-delay", Duration.ofMinutes(5));
        var approval = ctx.waitForCallback(
            "manager-approval",
            (callbackId, stepCtx) -> notifyManager(callbackId, order));
        return new OrderResult(approval.isApproved() ? "approved" : "rejected", validated.getId());
    }

    private void notifyManager(String callbackId, Order order) {
        // Notify the approver with callbackId.
    }
}
