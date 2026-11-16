//! Example durable function: ParallelMixed with differently typed branches.
//!
//! Run: npx durable-viz examples/order_parallel_mixed.rs --open

use aws_durable_execution_sdk as durable;

async fn handler(
    event: serde_json::Value,
    ctx: durable::DurableContext,
) -> Result<serde_json::Value, durable::BoxError> {
    let mut branches = durable::BranchSet::new();

    let profile = branches.add("load-profile", |child| async move {
        child
            .step(|_| async { Ok("customer-1".to_owned()) })
            .name("load-profile")
            .sub_type(durable::OperationSubType::new("ProfileLookup").unwrap())
            .await
            .map_err(Into::into)
    });

    let order_count = branches.add("count-orders", |child| async move {
        child
            .step(|_| async { Ok(3_u32) })
            .name("count-orders")
            .await
            .map_err(Into::into)
    });

    ctx.parallel_mixed(branches)
        .name("load-order")
        .max_concurrency(2)
        .await?;

    Ok(serde_json::json!({
        "customer": profile.into_result()?,
        "orders": order_count.into_result()?,
        "event": event,
    }))
}

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    durable::init_default_subscriber()?;
    durable::run(handler).await
}
