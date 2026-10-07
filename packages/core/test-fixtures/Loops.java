import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;

public class Loops extends DurableHandler<Input, String> {
    @Override
    protected String handleRequest(Input input, DurableContext ctx) {
        ctx.step("start", String.class, c -> begin());

        for (Order order : input.getOrders()) {
            ctx.step("validate", String.class, c -> validate(order));
            if (order.isVip()) {
                ctx.step("vip-perk", String.class, c -> perk(order));
            }
            ctx.step("charge", String.class, c -> charge(order));
        }

        for (int attempt = 0; attempt < 3; attempt++) {
            ctx.wait("backoff", Duration.ofSeconds(5));
        }

        for (String region : regions(input.getRegions())) {
            ctx.step("per-region", String.class, c -> deploy(region));
        }

        while (!isDone()) {
            ctx.step("poll", String.class, c -> poll());
        }

        outer: do {
            ctx.step("do-step", String.class, c -> work());
        } while (hasMore(input));

        for (Order ignored : input.getOrders()) {
            log(ignored);
        }

        ctx.step("finish", String.class, c -> done());
        return "";
    }
}
