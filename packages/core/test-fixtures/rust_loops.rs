use aws_durable_execution_sdk as durable;

#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    durable::run(|orders: Vec<String>, ctx: durable::DurableContext| async move {
        ctx.step(|_| async { Ok("start".to_owned()) }).name("start").await?;

        for order in orders.iter() {
            ctx.step(|_| async { Ok("ok".to_owned()) }).name("validate").await?;
            if order == "vip" {
                ctx.step(|_| async { Ok("ok".to_owned()) }).name("vip-perk").await?;
            }
            ctx.step(|_| async { Ok("ok".to_owned()) }).name("charge").await?;
        }

        for attempt in 0..3 {
            ctx.wait(std::time::Duration::from_secs(5)).name("backoff").await?;
        }

        'outer: while !done {
            ctx.step(|_| async { Ok("ok".to_owned()) }).name("poll").await?;
        }

        loop {
            ctx.step(|_| async { Ok("ok".to_owned()) }).name("forever").await?;
            break;
        }

        for ignored in orders.iter() {
            println!("{}", ignored);
        }

        ctx.step(|_| async { Ok("done".to_owned()) }).name("finish").await?;
        Ok("done".to_owned())
    })
    .await
}
