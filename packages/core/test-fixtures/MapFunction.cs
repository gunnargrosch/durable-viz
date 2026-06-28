/**
 * Test fixture for MapAsync.
 */

using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;
using Amazon.Lambda.RuntimeSupport;
using Amazon.Lambda.Serialization.SystemTextJson;

namespace TestFunction;

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
        => DurableFunction.WrapAsync<TestEvent, TestResult>(Workflow, input, context);

    private async Task<TestResult> Workflow(TestEvent input, IDurableContext ctx)
    {
        var batch = await ctx.MapAsync<string, int>(
            new[] { "a", "b", "c" },
            async (childCtx, item, idx, items, _) =>
            {
                await Task.CompletedTask;
                return idx;
            },
            name: "process");

        return new TestResult { Data = batch.GetResults().Sum().ToString() };
    }
}

public class TestEvent { public string? Id { get; set; } }
public class TestResult { public string? Data { get; set; } }
