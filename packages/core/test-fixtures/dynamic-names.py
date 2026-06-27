from aws_durable_execution_sdk_python import DurableContext, durable_execution

def do_work(x): return x

@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    context.step(do_work(event["id"]))
    context.step(do_work(event["id"]), name="explicit-name")
    comp_name = "runtime-name"
    context.step(do_work(event["id"]), name=comp_name)
