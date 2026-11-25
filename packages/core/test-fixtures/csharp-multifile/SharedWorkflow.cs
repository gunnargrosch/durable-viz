using Amazon.Lambda.DurableExecution;

namespace MultiFile;

public static class SharedWorkflow
{
    public static async Task<string> RunAsync(object input, IDurableContext ctx)
    {
        await ctx.StepAsync(async (_, _) => "loaded", name: "shared-step");
        await ctx.WaitAsync(TimeSpan.FromSeconds(1), name: "shared-wait");
        return "done";
    }
}
