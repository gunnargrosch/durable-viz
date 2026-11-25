using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;

public class NestedCSharpOperations
{
    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<object?, string>(Workflow, input, context);

    private async Task<string> Workflow(object input, IDurableContext ctx)
    {
        var child = await ctx.RunInChildContextAsync(async (childContext, _ct) =>
        {
            await childContext.StepAsync(async (_, _) => "child-step", name: "child-step");
            await childContext.WaitAsync(TimeSpan.FromSeconds(1), name: "child-wait");
            return "done";
        }, name: "nested-child");

        return child;
    }
}
