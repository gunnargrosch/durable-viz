from aws_durable_execution_sdk_python.config import Duration
from aws_durable_execution_sdk_python.context import DurableContext
from aws_durable_execution_sdk_python.execution import durable_execution
from aws_durable_execution_sdk_python_extensions.compute.microvm import (
    MicrovmConfig,
    MicrovmInvokeOptions,
    MicrovmSession,
    MicrovmSessionConfig,
    microvm,
    microvm_session,
)


@durable_execution
def handler(event: dict, context: DurableContext) -> dict:
    def pipeline(vm: MicrovmSession, session_context: DurableContext) -> dict:
        written = vm.invoke(
            session_context,
            "write",
            job_input={"key": event["key"]},
            options=MicrovmInvokeOptions(
                path="/write",
                timeout=Duration.from_minutes(5),
            ),
        )
        session_context.wait(Duration.from_seconds(5), name="pause")
        return vm.invoke(
            session_context,
            "read",
            job_input=written,
            options=MicrovmInvokeOptions(
                path="/read",
                timeout=Duration.from_minutes(5),
            ),
        )

    # One job in a new MicroVM. The MicroVM is terminated when the job ends.
    build = microvm(
        context,
        "build",
        job_input={"key": event["key"]},
        config=MicrovmConfig(
            image_identifier="image",
            execution_role_arn="role",
            timeout=Duration.from_minutes(5),
        ),
    )

    # Several jobs share one MicroVM, its files, and its processes.
    session = microvm_session(
        context,
        "pipeline",
        config=MicrovmSessionConfig(
            image_identifier="image",
            execution_role_arn="role",
            timeout=Duration.from_minutes(10),
        ),
        handler=pipeline,
    )
    return {"build": build, "session": session}
