import java.util.Map;
import software.amazon.lambda.durable.DurableContext;
import software.amazon.lambda.durable.DurableHandler;

public class NestedGenerics extends DurableHandler<Map<String, Object>, Map<String, Object>> {
    public Map<String, Object> handleRequest(Map<String, Object> event, DurableContext context) {
        context.step("nested-generics-step", Map.class, c -> doWork());
        return Map.of("ok", true);
    }
}
