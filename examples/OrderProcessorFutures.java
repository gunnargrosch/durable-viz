package com.example.orders;

import software.amazon.lambda.durable.DurableHandler;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableFuture;
import software.amazon.lambda.durable.StepContext;
import software.amazon.lambda.durable.config.Duration;
import software.amazon.lambda.durable.config.StepConfig;
import software.amazon.lambda.durable.config.StepSemantics;
import software.amazon.lambda.durable.config.InvokeConfig;
import software.amazon.lambda.durable.config.MapConfig;
import software.amazon.lambda.durable.config.ParallelConfig;
import software.amazon.lambda.durable.config.ParallelBranchConfig;
import software.amazon.lambda.durable.config.CompletionConfig;
import software.amazon.lambda.durable.config.NestingType;
import software.amazon.lambda.durable.config.WithRetryConfig;
import software.amazon.lambda.durable.config.RunInChildContextConfig;

public class OrderProcessorFutures extends DurableHandler<Order, OrderResult> {

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        // Step with AtMostOncePerRetry semantics
        ctx.step("validate-order", Order.class,
            stepCtx -> validateOrder(order),
            StepConfig.builder()
                .semanticsPerRetry(StepSemantics.AT_MOST_ONCE_PER_RETRY)
                .build());

        // Parallel with FLAT nesting and firstSuccessful completion
        var parallel = ctx.parallel("prepare",
            ParallelConfig.builder()
                .nestingType(NestingType.FLAT)
                .completionConfig(CompletionConfig.firstSuccessful())
                .build());
        parallel.branch("reserve-inventory", Reservation.class,
            branchCtx -> reserveInventory(order));
        parallel.branch("process-payment", Payment.class,
            branchCtx -> processPayment(order));
        parallel.close();
        parallel.get();

        // Map with FLAT nesting
        var items = order.getItems();
        var mapResult = ctx.map("batch-process", items, OrderResult.class,
            (item, index, branchCtx) -> branchCtx.step("process-item" + index, OrderResult.class,
                sc -> processItem(item)),
            MapConfig.builder()
                .nestingType(NestingType.FLAT)
                .completionConfig(CompletionConfig.allCompleted())
                .build());

        // Invoke with tenant isolation
        var shipment = ctx.invoke("fulfillment-service",
            new ShipmentRequest(order.getId()),
            ShipmentResult.class,
            InvokeConfig.builder()
                .tenantId("tenant-abc-123")
                .build());

        // withRetry with FLAT child context
        var retryResult = ctx.withRetry("retry-fulfillment",
            (attempt, retryCtx) -> retryCtx.step("fulfillment-attempt-" + attempt, OrderResult.class,
                sc -> validateOrder(order)),
            WithRetryConfig.builder()
                .wrapInChildContext(true)
                .build());

        // Run in child context with FLAT nesting
        var childResult = ctx.runInChildContext("isolated-logic", OrderResult.class,
            childCtx -> childCtx.step("inner-step", OrderResult.class,
                sc -> validateOrder(order)),
            RunInChildContextConfig.builder()
                .isVirtual(true)
                .build());

        // DurableFuture.allOf - combine multiple async operations
        var future1 = ctx.stepAsync("async-validate", Order.class,
            stepCtx -> validateOrder(order));
        var future2 = ctx.invokeAsync("async-fulfillment",
            new ShipmentRequest(order.getId()),
            ShipmentResult.class);
        var allResults = DurableFuture.allOf(future1, future2);

        // DurableFuture.anyOf - wait for first async operation to complete
        var asyncInv = ctx.invokeAsync("any-fulfillment",
            new ShipmentRequest(order.getId()),
            ShipmentResult.class);
        var firstResult = DurableFuture.anyOf(asyncInv);

        // Final step
        ctx.step("send-confirmation", Void.class,
            stepCtx -> sendConfirmation(order));

        return new OrderResult("completed", order.getId());
    }

    private Order validateOrder(Order order) { return order; }
    private Reservation reserveInventory(Order order) { return new Reservation(); }
    private Payment processPayment(Order order) { return new Payment(); }
    private OrderResult processItem(Order order) { return new OrderResult("processed", order.getId()); }
    private void sendConfirmation(Order order) { }
}

// Stub types for compilation
class Order { String getId() { return ""; } java.util.List<Order> getItems() { return java.util.List.of(); } }
class OrderResult { OrderResult(String s, String id) {} }
class Reservation {}
class Payment {}
class ShipmentRequest { ShipmentRequest(String id) {} }
class ShipmentResult {}
