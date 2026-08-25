use std::time::Duration;

use aws_durable_execution_sdk as durable;
use durable::Branch;

/// Processes an order: validates, fans out inventory and payment checks in
/// parallel, waits for a warehouse, then requires manager approval via callback.
async fn handler(
    event: serde_json::Value,
    ctx: durable::DurableContext,
) -> Result<serde_json::Value, durable::BoxError> {
    let validated = ctx
        .step(|_| async { Ok(event.get("orderId").cloned()) })
        .name("validate-order")
        .await?;

    let prepared = ctx
        .parallel(vec![
            Branch::new("check-inventory", |child| async move {
                child
                    .step(|_| async { Ok(true) })
                    .name("inventory")
                    .await
                    .map_err(Into::into)
            }),
            Branch::new("reserve-payment", |child| async move {
                child
                    .step(|_| async { Ok(true) })
                    .name("payment")
                    .await
                    .map_err(Into::into)
            }),
        ])
        .name("prepare-order")
        .max_concurrency(2)
        .await?;

    ctx.wait(Duration::from_secs(30))
        .name("warehouse-processing")
        .await?;

    let approval = ctx
        .wait_for_callback::<String, _, _>(|_cb_ctx, _cb_id| async { Ok(()) })
        .name("manager-approval")
        .await?;

    if validated.is_some() {
        let shipped = ctx
            .step(|_| async { Ok("shipped".to_owned()) })
            .name("ship-order")
            .await?;
        Ok(serde_json::json!({ "shipped": shipped, "branches": prepared.len() }))
    } else {
        Ok(serde_json::json!({ "status": "skipped", "approval": approval }))
    }
}

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    lambda_runtime::tracing::init_default_subscriber();
    durable::run(handler).await
}
