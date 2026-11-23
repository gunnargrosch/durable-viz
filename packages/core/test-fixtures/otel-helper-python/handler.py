from aws_durable_execution_sdk_python import DurableContext, durable_execution

from .otel import load_otel_plugins


@durable_execution(plugins=[load_otel_plugins()])
def handler(event: dict, context: DurableContext) -> dict:
    context.step(lambda: event["order_id"], name="load-order")
    return {"status": "completed"}
