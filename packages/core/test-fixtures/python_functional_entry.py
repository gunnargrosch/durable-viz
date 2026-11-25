from aws_durable_execution_sdk_python.context import DurableContext
from aws_durable_execution_sdk_python.execution import durable_execution


def _handler(event: dict, context: DurableContext) -> str:
    context.step(lambda: event["value"], name="functional-step")
    return "done"


handler = durable_execution(_handler)
