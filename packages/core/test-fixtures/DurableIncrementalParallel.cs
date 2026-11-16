using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;

namespace OrderProcessor;

public class Function
{
    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<Order, OrderResult>(Workflow, input, context);

    private async Task<OrderResult> Workflow(Order order, IDurableContext ctx)
    {
        await using var parallel = ctx.CreateParallel("prepare-order", new ParallelConfig
        {
            MaxConcurrency = 2,
        });

        parallel.Branch<Reservation>("reserve-inventory", async (branchCtx, _) =>
        {
            await Task.CompletedTask;
            return new Reservation();
        });

        parallel.Branch<Payment>("process-payment", async (branchCtx, _) =>
        {
            await Task.CompletedTask;
            return new Payment();
        });

        await parallel.CompleteAsync();

        await ctx.StepAsync(
            async (_, _) => { await Task.CompletedTask; return "TRK-1"; },
            name: "ship-order",
            config: new StepConfig { SubType = "ShipOrder" });

        return new OrderResult { Status = "completed", OrderId = order.OrderId };
    }
}

public record Order(string OrderId);

public class OrderResult
{
    public string? Status { get; set; }
    public string? OrderId { get; set; }
}

public class Reservation { }
public class Payment { }
