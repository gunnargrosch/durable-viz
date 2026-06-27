from aws_durable_execution_sdk_python import DurableContext, durable_execution

def validate(x): return x
def charge(x, y): return y

@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    context.step(
        validate(event["id"]),
        name="validate_order",
    )
    context.step(
        charge(event["id"], event["amount"]),
        name="process_payment",
    )
