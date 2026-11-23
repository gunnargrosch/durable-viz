package com.example.otel;

import software.amazon.lambda.durable.otel.ExecutionOtelPlugin;
import software.amazon.lambda.durable.otel.InvocationOtelPlugin;
import software.amazon.lambda.durable.plugin.DurableExecutionPluginFactory;

public final class OtelPlugins {

    private OtelPlugins() {}

    public static DurableExecutionPluginFactory createPluginFactory() {
        return "execution".equals(System.getenv("OTEL_PLUGIN_MODE"))
            ? ExecutionOtelPlugin.factory()
            : InvocationOtelPlugin.factory();
    }
}
