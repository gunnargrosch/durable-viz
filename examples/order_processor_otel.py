from aws_durable_execution_sdk_python import DurableContext, durable_execution
from aws_durable_execution_sdk_python_otel import create_otel_plugin_factory


@durable_execution(plugins=[create_otel_plugin_factory(mode="invocation")])
def handler(event: dict, context: DurableContext) -> dict:
    order = context.step(lambda: {"id": event["order_id"]}, name="load-order")
    approval = context.wait_for_callback(name="manager-approval")
    context.step(
        lambda: {"id": order["id"], "approval": approval},
        name="publish-order",
    )
    return {"status": "published"}
