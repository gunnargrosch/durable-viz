from aws_durable_execution_sdk_python import (
    DurableContext,
    durable_execution,
    durable_with_child_context,
    with_retry,
    WithRetryConfig,
)


@durable_with_child_context
def child_operation(ctx: DurableContext, value: str) -> str:
    ctx.step(lambda: value, name="child-step")
    return value


def retry_operation(ctx: DurableContext, attempt: int) -> str:
    ctx.step(lambda: attempt, name="retry-step")
    return "ok"


@durable_execution
def handler(event: dict, context: DurableContext) -> str:
    context.run_in_child_context(child_operation(str(event)), name="nested-child")
    with_retry(context, retry_operation, WithRetryConfig(), name="nested-retry")
    return "done"
