from aws_durable_execution_sdk_python import DurableContext, durable_execution

@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    context.step(begin(), name="start")

    for order in event["orders"]:
        context.step(validate(order), name="validate")
        if order["vip"]:
            context.step(perk(order), name="vip-perk")
        context.step(charge(order), name="charge")

    for attempt in range(3):  # retry a few times
        context.wait(Duration.from_seconds(5), name="backoff")

    while not is_done():

        context.step(poll(), name="poll")

    async for item in stream(event):
        context.step(handle(item), name="stream-item")

    for ignored in event["orders"]:
        log(ignored)

    context.step(finish(), name="finish")
    return {}
