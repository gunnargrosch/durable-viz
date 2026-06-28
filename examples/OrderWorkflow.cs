/**
 * Example durable function — order processing workflow (C#).
 *
 * Requires the preview NuGet package:
 *   dotnet add package Amazon.Lambda.DurableExecution --version 0.1.1-preview
 *
 * Run: npx durable-viz examples/OrderWorkflow.cs --open
 */

using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;
using Amazon.Lambda.RuntimeSupport;
using Amazon.Lambda.Serialization.SystemTextJson;

namespace OrderProcessor;

public class Function
{
    public static async Task Main(string[] args)
    {
        var handler = new Function();
        var serializer = new DefaultLambdaJsonSerializer();
        using var handlerWrapper = HandlerWrapper.GetHandlerWrapper<DurableExecutionInvocationInput, DurableExecutionInvocationOutput>(handler.Handler, serializer);
        using var bootstrap = new LambdaBootstrap(handlerWrapper);
        await bootstrap.RunAsync();
    }

    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<OrderEvent, OrderResult>(Workflow, input, context);

    private async Task<OrderResult> Workflow(OrderEvent order, IDurableContext ctx)
    {
        // Validate and enrich the order
        var validated = await ctx.StepAsync(
            async (_, _) =>
            {
                await Task.CompletedTask;
                return new ValidatedOrder(order.OrderId, order.Items, order.Total, true, DateTime.UtcNow);
            },
            name: "validate-order");

        // Reserve inventory in parallel
        var batch = await ctx.ParallelAsync(
            new[]
            {
                new DurableBranch<object>("check-inventory", async (_, _) =>
                {
                    await Task.CompletedTask;
                    return new { status = "reserved", order.Items };
                }),
                new DurableBranch<object>("reserve-payment", async (_, _) =>
                {
                    await Task.CompletedTask;
                    return new { status = "authorized", order.Total };
                }),
            },
            name: "prepare-order");

        // Wait for warehouse processing
        await ctx.WaitAsync(
            TimeSpan.FromHours(2),
            name: "warehouse-processing");

        // High-value orders need manager approval
        if (order.Total > 5000)
        {
            var approval = await ctx.WaitForCallbackAsync<ApprovalResult>(
                submitter: async (callbackId, cbCtx, _) =>
                {
                    ctx.Logger.LogInformation("Awaiting approval for {OrderId}", order.OrderId);
                    await Task.CompletedTask;
                },
                name: "manager-approval");

            if (!approval.Approved)
            {
                return new OrderResult { Status = "rejected", OrderId = order.OrderId, Notes = approval.Notes };
            }
        }

        // Fulfill the order
        var shipment = await ctx.StepAsync(
            async (_, _) =>
            {
                await Task.CompletedTask;
                return $"TRK-{order.OrderId}";
            },
            name: "fulfill-order");

        return new OrderResult { Status = "completed", OrderId = order.OrderId, TrackingId = shipment };
    }
}

public class OrderEvent
{
    public string? OrderId { get; set; }
    public string[]? Items { get; set; }
    public decimal Total { get; set; }
}

public class OrderResult
{
    public string? Status { get; set; }
    public string? OrderId { get; set; }
    public string? TrackingId { get; set; }
    public string? Notes { get; set; }
}

public record ValidatedOrder(string OrderId, string[] Items, decimal Total, bool Confirmed, DateTime Timestamp);

public class ApprovalResult
{
    public bool Approved { get; set; }
    public string? Notes { get; set; }
}
