/**
 * Test fixture for WaitForConditionAsync with named arguments.
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
        var finalState = await ctx.WaitForConditionAsync<State>(
            check: async (state, ctx, _) =>
            {
                await Task.CompletedTask;
                return new State(state.Counter + 1, ctx.AttemptNumber);
            },
            config: new WaitForConditionConfig<State>
            {
                InitialState = new State(0, 0),
                WaitStrategy = WaitStrategy.Fixed<State>(
                    delay: TimeSpan.FromSeconds(2),
                    maxAttempts: 10,
                    isDone: s => s.Counter >= 3)
            },
            name: "happy_poll");

        return new TestResult { Data = finalState.Counter.ToString() };
    }
}

public record State(int Counter, int AttemptNumber);

public class TestEvent { public string? Id { get; set; } }
public class TestResult { public string? Data { get; set; } }
