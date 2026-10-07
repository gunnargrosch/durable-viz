"""Example durable function: batch order processing with loops.

Run: npx durable-viz examples/order_batch_loop.py --open
"""

from aws_durable_execution_sdk_python import DurableContext, durable_execution


@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    context.step(load_batch(event), name="load-batch")

    # Runs once per order. Each iteration is a separate set of checkpointed steps.
    for order in event["orders"]:
        context.step(validate_order(order), name="validate-order")

        if order["total"] > 10000:
            context.wait_for_callback(notify_manager, name="manager-approval")

        context.step(charge_order(order), name="charge-order")

    # Poll up to three times, waiting between attempts.
    for attempt in range(3):
        context.wait(Duration.from_seconds(30), name="wait-for-settlement")
        context.step(check_settlement(event), name="check-settlement")

    return context.step(send_summary(event), name="send-summary")
