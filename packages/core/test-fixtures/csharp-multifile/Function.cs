using Amazon.Lambda.Core;
using Amazon.Lambda.DurableExecution;

namespace MultiFile;

public class Function
{
    public Task<DurableExecutionInvocationOutput> Handler(
        DurableExecutionInvocationInput input, ILambdaContext context)
        => DurableFunction.WrapAsync<object?, string>(SharedWorkflow.RunAsync, input, context);
}
