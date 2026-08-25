/**
 * Test fixture for the .NET Lambda Annotations model:
 * [LambdaFunction] + [DurableExecution] on a method with an IDurableContext
 * parameter, no DurableFunction.WrapAsync call.
 */

using Amazon.Lambda.Annotations;
using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace TestAnnotations;

public class Function
{
    [LambdaFunction]
    [DurableExecution(executionTimeout: 300, retentionPeriodInDays: 7)]
    public async Task<TestResult> Workflow(TestEvent input, IDurableContext ctx)
    {
        var step1 = await ctx.StepAsync(
            async (_, _) => { await Task.CompletedTask; return $"a-{input.OrderId}"; },
            name: "step-1");

        var fanout = await ctx.ParallelAsync(
            new[]
            {
                new DurableBranch<object>("branch-a", async (_, _) => { await Task.CompletedTask; return null; }),
                new DurableBranch<object>("branch-b", async (_, _) => { await Task.CompletedTask; return null; }),
            },
            name: "prepare",
            config: new ParallelConfig { MaxConcurrency = 2 });

        return new TestResult { Status = "completed", Data = step1 };
    }
}

public class TestEvent { public string? OrderId { get; set; } }
public class TestResult { public string? Status { get; set; } public string? Data { get; set; } }
