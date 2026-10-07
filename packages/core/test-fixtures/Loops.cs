using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;

namespace TestFunction;

public class Function
{
    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<TestEvent, TestResult>(Workflow, input, context);

    private async Task<TestResult> Workflow(TestEvent input, IDurableContext ctx)
    {
        await ctx.StepAsync(async (_, _) => "start", name: "start");

        foreach (var order in input.Orders)
        {
            await ctx.StepAsync(async (_, _) => "ok", name: "validate");
            if (order.IsVip)
            {
                await ctx.StepAsync(async (_, _) => "ok", name: "vip-perk");
            }
            await ctx.StepAsync(async (_, _) => "ok", name: "charge");
        }

        for (int attempt = 0; attempt < 3; attempt++) {
            await ctx.StepAsync(async (_, _) => "ok", name: "retry");
        }

        foreach (var region in GetRegions(input.Id))
        {
            await ctx.StepAsync(async (_, _) => "ok", name: "per-region");
        }

        while (!IsDone())
        {
            await ctx.StepAsync(async (_, _) => "ok", name: "poll");
        }

        do
        {
            await ctx.StepAsync(async (_, _) => "ok", name: "do-step");
        } while (HasMore(input));

        foreach (var ignored in input.Orders)
        {
            Log(ignored);
        }

        await ctx.StepAsync(async (_, _) => "done", name: "finish");
        return new TestResult();
    }
}

public class TestEvent { public string? Id { get; set; } }
public class TestResult { public string? Data { get; set; } }
