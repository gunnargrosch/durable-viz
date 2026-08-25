# Durable Viz

Visualize and build [AWS Lambda Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) workflows in VS Code.

- **View mode:** Parse handler code and render an interactive flowchart.
- **Build mode:** Design workflows from scratch and generate handler boilerplate.

Supports **TypeScript/JavaScript**, **Python**, **Java**, **C# (.NET)**, and **Rust** runtimes.

## Features

### View Mode

- **Interactive diagram.** See your durable function as a flowchart in a side panel.
- **Scroll zoom** and **click-drag pan**.
- **Click-to-navigate** to source lines.
- **Auto-refresh** on file save.
- **Direction toggle** (TD/LR), **PNG export**, **source view** (Mermaid/JSON).

### Build Mode

- **Drag-and-drop palette** with 15 primitives filtered by language.
- **Click-to-connect edges.** Conditions auto-label `if`/`else` branches.
- **Compound nodes** for Parallel/Map with drag-to-nest.
- **Code generation** in TypeScript, Python, Java, C#, and Rust.
- **Mermaid preview**, **save/load JSON**, **undo/redo**.

## Usage

| Mode | Command |
| --- | --- |
| **View** | `Durable Viz: Open Lambda Durable Function Workflow` |
| **Build** | `Durable Viz: Build Workflow Diagram` |

A toolbar button also appears in the editor title bar for `.ts`, `.js`, `.py`, `.java`, `.cs`, and `.rs` files.

## Supported Languages

| Language | Handler detection | SDK |
| --- | --- | --- |
| TypeScript / JavaScript | `withDurableExecution()` | `@aws/durable-execution-sdk-js` |
| Python | `@durable_execution` decorator | `aws-durable-execution-sdk-python` |
| Java | `extends DurableHandler` | `aws-durable-execution-sdk-java` |
| C# (.NET) | `DurableFunction.WrapAsync` or `[DurableExecution]` | `Amazon.Lambda.DurableExecution` |
| Rust | `durable::run(handler)` | `aws-durable-execution-sdk` |

## Links

- [GitHub Repository](https://github.com/gunnargrosch/durable-viz)
- [AWS Lambda Durable Functions Documentation](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)

## License

MIT
