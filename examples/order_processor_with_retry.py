"""
Sample Python durable function — order processing with with_retry and config features.
"""

from aws_durable_execution_sdk_python import (
    DurableContext,
    StepContext,
    durable_execution,
    durable_step,
    WithRetryConfig,
    with_retry,
)
from aws_durable_execution_sdk_python.config import (
    Duration,
    CallbackConfig,
    StepConfig,
    StepSemantics,
    CompletionConfig,
    NestingType,
    ParallelBranch,
    MapConfig,
    create_retry_strategy,
)


@durable_step
def validate_order(step_context: StepContext, order_id: str) -> dict:
    step_context.logger.info("Validating order", extra={"order_id": order_id})
    return {"order_id": order_id, "valid": True}


@durable_step
def process_payment(step_context: StepContext, order_id: str) -> dict:
    step_context.logger.info("Processing payment", extra={"order_id": order_id})
    return {"charged": True}


@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    order_id = event["order_id"]

    # Step with AtMostOncePerRetry semantics
    context.step(
        validate_order(order_id),
        name="validate_order",
        config=StepConfig(
            step_semantics=StepSemantics.AT_MOST_ONCE_PER_RETRY,
        ),
    )

    # Parallel with FLAT nesting and first_successful completion
    results = context.parallel(
        [
            ParallelBranch(func=lambda ctx: ctx.step(lambda sc: {}, name="reserve-inventory"), name="reserve-inventory"),
            ParallelBranch(func=lambda ctx: ctx.step(lambda sc: {}, name="process-payment"), name="process-payment"),
        ],
        name="prepare-order",
        config={
            "nesting_type": NestingType.FLAT,
            "completion_config": CompletionConfig.first_successful(),
        },
    )

    # Map with FLAT nesting and completion config
    orders = event.get("orders", [])
    if orders:
        context.map(
            orders,
            lambda ctx, item, idx, items: ctx.step(lambda sc: {}, name=f"process-{idx}"),
            name="batch-process",
            config=MapConfig(
                nesting_type=NestingType.FLAT,
                completion_config=CompletionConfig.all_completed(),
            ),
        )

    # Invoke with tenant isolation
    context.invoke(
        function_name="fulfillment-service",
        payload={"order_id": order_id},
        name="invoke_fulfillment",
        config={"tenant_id": "tenant-abc-123"},
    )

    # with_retry for a flaky external call
    def retry_fulfill(ctx: DurableContext, attempt: int) -> dict:
        ctx.logger.info("Attempting fulfillment", extra={"attempt": attempt})
        return ctx.step(
            process_payment(order_id),
            name=f"fulfillment-attempt-{attempt}",
        )

    context.step(lambda sc: {}, name="prepare-fulfillment")
    with_retry(
        context,
        retry_fulfill,
        WithRetryConfig(
            retry_strategy=create_retry_strategy(max_attempts=3),
        ),
        name="retry-fulfillment",
    )
    context.step(lambda sc: {}, name="send-confirmation")

    return {"status": "completed", "order_id": order_id}
