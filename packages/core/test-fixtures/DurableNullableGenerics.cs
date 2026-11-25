using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;

namespace NullableGenerics;

public class Function
{
    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<object?, List<string>>(Workflow, input, context);

    private async Task<string?> Workflow(object? input, IDurableContext ctx)
    {
        var value = await ctx.StepAsync(async (_, _) => "value", name: "nullable-step");
        return value;
    }
}
