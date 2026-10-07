/**
 * Example durable function: batch order processing with loops.
 *
 * Run: npx durable-viz examples/OrderBatchLoop.cs --open
 */

using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;

namespace OrderBatch;

public class Function
{
    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<Batch, BatchResult>(Workflow, input, context);

    private async Task<BatchResult> Workflow(Batch batch, IDurableContext ctx)
    {
        await ctx.StepAsync(async (_, _) => await LoadBatch(batch), name: "load-batch");

        // Runs once per order. Each iteration is a separate set of checkpointed steps.
        foreach (var order in batch.Orders)
        {
            await ctx.StepAsync(async (_, _) => await Validate(order), name: "validate-order");

            if (order.Total > 10000)
            {
                await ctx.WaitForCallbackAsync(
                    async (callbackId, _) => await NotifyManager(callbackId, order),
                    name: "manager-approval");
            }

            await ctx.StepAsync(async (_, _) => await Charge(order), name: "charge-order");
        }

        // Poll up to three times, waiting between attempts.
        for (int attempt = 0; attempt < 3; attempt++)
        {
            await ctx.WaitAsync(TimeSpan.FromSeconds(30), name: "wait-for-settlement");
            await ctx.StepAsync(async (_, _) => await CheckSettlement(batch), name: "check-settlement");
        }

        return await ctx.StepAsync(async (_, _) => await SendSummary(batch), name: "send-summary");
    }
}
