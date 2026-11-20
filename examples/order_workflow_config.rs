use std::time::Duration;

use aws_durable_execution_sdk as durable;
use durable::builders::map_parallel::CompletionConfig;
use durable::builders::wait_for_condition::WaitDecision;

/// Processes an order end to end, exercising the config-level features:
/// retry strategies, step semantics, map completion policies, tenant-isolated
/// invokes, child contexts, and the concurrency combinators.
async fn handler(
    event: serde_json::Value,
    ctx: durable::DurableContext,
) -> Result<serde_json::Value, durable::BoxError> {
    // A flaky step with a retry strategy and at-most-once-per-retry semantics.
    let charged = ctx
        .step(|step_ctx| async move {
            if step_ctx.attempt() < 3 {
                return Err::<u32, durable::BoxError>("transient failure".into());
            }
            Ok(99)
        })
        .name("charge-payment")
        .retry_strategy(|_err, attempt| {
            if attempt >= 3 {
                durable::RetryDecision::Stop
            } else {
                durable::RetryDecision::retry(Duration::from_secs(1))
            }
        })
        .semantics(durable::StepSemantics::AtMostOncePerRetry)
        .sub_type(durable::OperationSubType::new("ChargeCard").unwrap())
        .await?;

    // A map fan-out tolerating a single failure, bounded to two concurrent items.
    let processed = ctx
        .map(vec![1, 2, 3, 4], |_child, item: u32, _idx| async move {
            Ok(item * 10)
        })
        .name("process-items")
        .completion(
            CompletionConfig::builder()
                .tolerated_failure_count(1)
                .build()?,
        )
        .max_concurrency(2)
        .await?;

    // A chained invoke of another durable function, tenant-isolated.
    let delegated = ctx
        .invoke::<serde_json::Value>("fulfillment-service", serde_json::json!({ "order": event }))
        .name("delegate-fulfillment")
        .tenant_id("tenant-abc-123")
        .await?;

    // A virtual child context: it has its own namespace but writes no record.
    let summary = ctx
        .run_in_child_context(|child| async move {
            let value = child
                .step(|_| async { Ok(42) })
                .name("compute")
                .await?;
            Ok(value * 2)
        })
        .name("child-branch")
        .virtual_context()
        .sub_type(durable::OperationSubType::new("Settlement").unwrap())
        .await?;

    // A virtual retry block wrapping a single step.
    let retried = ctx
        .with_retry(|_child, _attempt| async move { Ok("done".to_owned()) })
        .name("retry-block")
        .virtual_context()
        .retry_strategy(|_err, _attempt| durable::RetryDecision::Stop)
        .await?;

    // A bounded condition poll.
    let counted = ctx
        .wait_for_condition(|_ctx, state: i32| async move { Ok(state + 1) }, 0)
        .wait_strategy_fn(|state: i32, _attempt| {
            if state >= 2 {
                WaitDecision::complete()
            } else {
                WaitDecision::continue_with(Duration::from_secs(1))
            }
        })
        .name("poll-gate")
        .await?;

    // A callback minted and awaited for manager approval.
    let cb = ctx
        .create_callback::<String>()
        .name("manager-approval")
        .sub_type(durable::OperationSubType::new("ManagerApproval").unwrap())
        .await?;
    let approval = cb.result().await?;

    // Race two candidate steps; the winner is checkpointed for replay.
    let first = ctx
        .step(|_| async { Ok("a".to_owned()) })
        .name("candidate-a")
        .future();
    let second = ctx
        .step(|_| async { Ok("b".to_owned()) })
        .name("candidate-b")
        .future();
    let winner = ctx.race([first, second]).name("fastest-candidate").await?;

    Ok(serde_json::json!({
        "charged": charged,
        "processed": processed.len(),
        "delegated": delegated,
        "summary": summary,
        "retried": retried,
        "counted": counted,
        "approval": approval,
        "winner": winner,
    }))
}

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    durable::init_default_subscriber()?;
    durable::run(handler).await
}
