package com.example.orders;

import software.amazon.lambda.durable.DurableHandler;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.StepContext;
import software.amazon.lambda.durable.config.Duration;
import software.amazon.lambda.durable.config.CallbackConfig;

public class OrderProcessor extends DurableHandler<Order, OrderResult> {

    private final InventoryService inventoryService = new InventoryService();
    private final PaymentService paymentService = new PaymentService();

    @Override
    protected OrderResult handleRequest(Order order, DurableContext ctx) {
        // Step 1: Reserve inventory
        var reservation = ctx.step("reserve-inventory", Reservation.class,
            stepCtx -> inventoryService.reserve(order.getItems()));

        // Step 2: Process payment
        var payment = ctx.step("process-payment", Payment.class,
            stepCtx -> paymentService.charge(order.getPaymentMethod(), order.getTotal()));

        // Step 3: Wait for shipping label
        ctx.wait("shipping-delay", Duration.ofMinutes(5));

        // Step 4: Invoke fulfillment service
        var shipment = ctx.invoke("fulfillment-service",
            new ShipmentRequest(order.getId(), reservation.getWarehouse()),
            ShipmentResult.class);

        // Step 5: High-value orders need manager approval
        if (order.getTotal() > 10000) {
            var approval = ctx.waitForCallback("manager-approval",
                callbackId -> notifyManager(callbackId, order),
                CallbackConfig.builder().timeout(Duration.ofHours(24)).build());

            if (!approval.isApproved()) {
                return new OrderResult("rejected", order.getId());
            }
        }

        // Step 6: Send confirmation
        ctx.step("send-confirmation", Void.class,
            stepCtx -> emailService.sendConfirmation(order));

        return new OrderResult("completed", order.getId());
    }

    private void notifyManager(String callbackId, Order order) {
        // Send Slack/email notification with callbackId
    }
}
