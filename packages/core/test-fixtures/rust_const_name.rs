use aws_durable_execution_sdk as durable;

async fn handler(
    _event: serde_json::Value,
    ctx: durable::DurableContext,
) -> Result<String, durable::BoxError> {
    let greeting = "hello-world";
    let result = ctx
        .step(|_| async { Ok("ok".to_owned()) })
        .name(greeting)
        .semantics(durable::StepSemantics::AtMostOncePerRetry)
        .retry_strategy(|_err, _attempt| durable::RetryDecision::Stop)
        .await?;
    Ok(result)
}

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    lambda_runtime::tracing::init_default_subscriber();
    durable::run(handler).await
}
