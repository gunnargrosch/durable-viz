import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;

public class DynamicNames extends DurableHandler<String, String> {
    protected String handleRequest(String input, DurableContext ctx) {
        ctx.step("string-literal", String.class, c -> doWork());
        String compName = "runtime";
        ctx.step(compName, String.class, c -> undo());
        ctx.step(getCompName(), String.class, c -> undo());
        ctx.step(
            "multi-line-name", String.class,
            c -> doStuff()
        );
        ctx.step(comp.name, String.class, c -> undo());
        return "";
    }
}
