# Durable Viz

Visualize [AWS Lambda Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) workflows directly in VS Code. Static analysis turns your handler code into an interactive flowchart, no deployment or execution required.

Supports **TypeScript/JavaScript**, **Python**, and **Java** runtimes.

## Features

- **Interactive diagram.** See your durable function as a flowchart in a side panel.
- **Scroll zoom.** Scroll wheel to zoom in/out, zooms toward cursor.
- **Click-drag pan.** Click and drag to move around the diagram.
- **Click-to-navigate.** Click any node to jump to that line in the source file.
- **Auto-refresh.** Diagram updates when you save the file.
- **All primitives.** Step, invoke, parallel, map, wait, callbacks, conditions, child contexts.

## Usage

1. Open a file containing a durable function handler.
2. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run **Durable Viz: Open Lambda Durable Function Workflow**.

The diagram appears in a side panel next to your code. A toolbar button also appears in the editor title bar for supported file types.

## Supported Languages

| Language | Handler detection | SDK |
| --- | --- | --- |
| TypeScript / JavaScript | `withDurableExecution()` | `@aws/durable-execution-sdk-js` |
| Python | `@durable_execution` decorator | `aws-durable-execution-sdk-python` |
| Java | `extends DurableHandler` | `aws-durable-execution-sdk-java` |

## Detected Primitives

| Primitive | TypeScript | Python | Java |
| --- | --- | --- | --- |
| Step | `context.step()` | `context.step()` | `ctx.step()` |
| Invoke | `context.invoke()` | `context.invoke()` | `ctx.invoke()` |
| Parallel | `context.parallel()` | `context.parallel()` | `ctx.parallel()` |
| Map | `context.map()` | `context.map()` | `ctx.map()` |
| Wait | `context.wait()` | `context.wait()` | `ctx.wait()` |
| Wait for Callback | `context.waitForCallback()` | `context.wait_for_callback()` | `ctx.waitForCallback()` |
| Create Callback | `context.createCallback()` | `context.create_callback()` | `ctx.createCallback()` |
| Wait for Condition | `context.waitForCondition()` | `context.wait_for_condition()` | `ctx.waitForCondition()` |
| Child Context | `context.runInChildContext()` | `context.run_in_child_context()` | `ctx.runInChildContext()` |

## Visual Encoding

Each primitive type has a distinct shape and color:

| Node | Shape | Color |
| --- | --- | --- |
| Start / End | Stadium | Blue |
| Step | Rectangle | Green |
| Invoke | Trapezoid | Amber |
| Parallel / Map | Hexagon | Purple |
| Wait / Callback | Circle | Red |
| Condition | Diamond | Indigo |
| Child Context | Subroutine | Teal |

Parallel branches are grouped inside a dashed border. Conditional branches show "yes" and "no" edges.

## CLI

This extension is part of [durable-viz](https://github.com/gunnargrosch/durable-viz), which also includes a CLI:

```shell
npx durable-viz handler.ts --open
```

## Links

- [GitHub Repository](https://github.com/gunnargrosch/durable-viz)
- [AWS Lambda Durable Functions Documentation](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)
- [Report an Issue](https://github.com/gunnargrosch/durable-viz/issues)

## License

MIT
