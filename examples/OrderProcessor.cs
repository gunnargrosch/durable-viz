/**
 * C# durable function — order processor with multiple primitives.
 *
 * Class-library programming model (no Main / LambdaBootstrap).
 * Deploys on the managed dotnet10 runtime with the handler string:
 *   OrderProcessor::OrderProcessor.Function::Handler
 *
 * Requires: dotnet add package Amazon.Lambda.DurableExecution --version 0.1.1-preview
 *
 * Run: npx durable-viz examples/OrderProcessor.cs --open
 */

using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;
using Amazon.Lambda.Serialization.SystemTextJson;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace OrderProcessor;

public class Function
{
    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<Order, OrderResult>(Workflow, input, context);

    private async Task<OrderResult> Workflow(Order order, IDurableContext ctx)
    {
        // Step 1: Validate the order
        var validated = await ctx.StepAsync(
            async (_, _) => { await Task.CompletedTask; return order with { Validated = true }; },
            name: "validate-order");

        // Step 2: Reserve inventory and process payment in parallel
        await ctx.ParallelAsync(
            new[]
            {
                new DurableBranch<object>("reserve-inventory", async (_, _) =>
                {
                    await Task.CompletedTask;
                    return new { status = "reserved", validated.Items };
                }),
                new DurableBranch<object>("process-payment", async (_, _) =>
                {
                    await Task.CompletedTask;
                    return new { status = "charged", validated.Total };
                }),
            },
            name: "prepare-order");

        // Step 3: Wait for shipping label (no compute charge)
        await ctx.WaitAsync(
            TimeSpan.FromMinutes(5),
            name: "shipping-delay");

        // Step 4: High-value orders need manager approval
        if (order.Total > 10000)
        {
            var approval = await ctx.WaitForCallbackAsync<ApprovalResult>(
                submitter: async (callbackId, cbCtx, _) =>
                {
                    ctx.Logger.LogInformation("Approval requested: {CallbackId}", callbackId);
                    await Task.CompletedTask;
                },
                name: "manager-approval");

            if (!approval.Approved)
            {
                return new OrderResult { Status = "rejected", OrderId = order.OrderId };
            }
        }

        // Step 5: Invoke fulfillment service
        await ctx.InvokeAsync<ShipmentRequest, ShipmentResult>(
            functionName: "fulfillment-service",
            payload: new ShipmentRequest(order.OrderId),
            name: "fulfillment-service");

        // Step 6: Send confirmation
        await ctx.StepAsync(
            async (_, _) => { await Task.CompletedTask; },
            name: "send-confirmation");

        return new OrderResult { Status = "completed", OrderId = order.OrderId };
    }
}

public record Order(string OrderId, string[] Items, decimal Total, bool Validated = false);

public class OrderResult
{
    public string? Status { get; set; }
    public string? OrderId { get; set; }
}

public class ShipmentRequest
{
    public string? OrderId { get; }
    public ShipmentRequest(string orderId) => OrderId = orderId;
}

public class ShipmentResult
{
    public string? TrackingId { get; set; }
    public string? Status { get; set; }
}

public class ApprovalResult
{
    public bool Approved { get; set; }
    public string? Notes { get; set; }
}
