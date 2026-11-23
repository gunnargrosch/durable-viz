import os

from aws_durable_execution_sdk_python_otel import create_otel_plugin_factory


def load_otel_plugins():
    mode = os.environ.get("OTEL_PLUGIN")
    if not mode:
        return []
    if mode == "execution":
        return [create_otel_plugin_factory()]
    if mode == "invocation":
        return [create_otel_plugin_factory(mode="invocation")]
    raise ValueError(f"Unknown OTEL_PLUGIN value: {mode}")
