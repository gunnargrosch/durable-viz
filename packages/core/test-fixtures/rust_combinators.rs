use aws_durable_execution_sdk as durable;

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    lambda_runtime::tracing::init_default_subscriber();
    durable::run(|name: String, ctx: durable::DurableContext| async move {
        let first = ctx
            .step(|_| async { Ok("first".to_owned()) })
            .name(&name)
            .future();
        let second = ctx
            .step(|_| async { Ok("second".to_owned()) })
            .name("second")
            .future();
        let winner = ctx.race([first, second]).name("fastest").await?;
        Ok(winner)
    })
    .await
}
