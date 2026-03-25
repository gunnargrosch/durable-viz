"""
Sample Python durable function — order processing workflow.
Based on AWS durable execution SDK Python patterns.
"""

from aws_durable_execution_sdk_python import (
    DurableContext,
    StepContext,
    durable_execution,
    durable_step,
)
from aws_durable_execution_sdk_python.config import (
    Duration,
    CallbackConfig,
    StepConfig,
    create_retry_strategy,
)


@durable_step
def validate_order(step_context: StepContext, order_id: str) -> dict:
    step_context.logger.info("Validating order", extra={"order_id": order_id})
    return {"order_id": order_id, "valid": True}


@durable_step
def charge_payment(step_context: StepContext, order_id: str, amount: float) -> dict:
    step_context.logger.info("Charging payment", extra={"order_id": order_id})
    return {"charged": True, "amount": amount}


@durable_step
def send_confirmation(step_context: StepContext, order_id: str, email: str) -> dict:
    step_context.logger.info("Sending confirmation", extra={"order_id": order_id})
    return {"sent": True}


def fulfill_order(context: DurableContext, order_id: str) -> dict:
    """Helper function that uses DurableContext to invoke fulfillment."""
    result = context.invoke(
        function_name="fulfillment-service",
        payload={"order_id": order_id},
        name="invoke_fulfillment",
    )
    return result


@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    order_id = event["order_id"]

    # Step 1: Validate the order
    validation = context.step(
        validate_order(order_id),
        name="validate_order",
    )

    # Step 2: Process payment
    payment = context.step(
        charge_payment(order_id, event["amount"]),
        name="process_payment",
    )

    # Step 3: Wait for warehouse confirmation
    context.wait(duration=Duration.from_seconds(30), name="warehouse_delay")

    # Step 4: Human approval for high-value orders
    if event["amount"] > 10000:
        callback = context.create_callback(
            name="manager_approval",
            config=CallbackConfig(timeout=Duration.from_hours(24)),
        )
        approval = callback.result()

    # Step 5: Fulfill the order (helper function with context.invoke)
    fulfill_order(context, order_id)

    # Step 6: Send confirmation
    context.step(
        send_confirmation(order_id, event["email"]),
        name="send_confirmation",
    )

    return {"status": "completed", "order_id": order_id}
