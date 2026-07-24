/**
 * Test fixture for StepSemantics and TenantId config extraction.
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
        var step1 = await ctx.StepAsync(
            async (_, _) => { await Task.CompletedTask; return "ok"; },
            name: "idempotent-step",
            config: new StepConfig { Semantics = StepSemantics.AtMostOncePerRetry });

        var result = await ctx.InvokeAsync<object, object>(
            functionName: "TenantFunction",
            payload: new { input.Id },
            name: "tenant-invoke",
            config: new InvokeConfig { TenantId = "tenant-abc-123" });

        return new TestResult { Data = result?.ToString() };
    }
}

public class TestEvent { public string? Id { get; set; } }
public class TestResult { public string? Data { get; set; } }
