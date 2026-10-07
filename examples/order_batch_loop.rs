//! Example durable function: batch order processing with loops.
//!
//! Run: npx durable-viz examples/order_batch_loop.rs --open

use aws_durable_execution_sdk as durable;

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    lambda_runtime::tracing::init_default_subscriber();
    durable::run(|batch: Batch, ctx: durable::DurableContext| async move {
        ctx.step(|_| async { load_batch(&batch).await })
            .name("load-batch")
            .await?;

        // Runs once per order. Each iteration is a separate set of checkpointed steps.
        for order in batch.orders.iter() {
            ctx.step(|_| async { validate(order).await })
                .name("validate-order")
                .await?;

            if order.total > 10000 {
                ctx.wait_for_callback(|callback_id| async move { notify_manager(callback_id).await })
                    .name("manager-approval")
                    .await?;
            }

            ctx.step(|_| async { charge(order).await })
                .name("charge-order")
                .await?;
        }

        // Poll up to three times, waiting between attempts.
        for _attempt in 0..3 {
            ctx.wait(std::time::Duration::from_secs(30))
                .name("wait-for-settlement")
                .await?;
            ctx.step(|_| async { check_settlement(&batch).await })
                .name("check-settlement")
                .await?;
        }

        ctx.step(|_| async { send_summary(&batch).await })
            .name("send-summary")
            .await
    })
    .await
}
