# Durable Viz

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version/gunnargrosch.durable-viz.svg)](https://marketplace.visualstudio.com/items?itemName=gunnargrosch.durable-viz)
[![Open VSX](https://img.shields.io/open-vsx/v/gunnargrosch/durable-viz)](https://open-vsx.org/extension/gunnargrosch/durable-viz)

Visualize and build [AWS Lambda Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) workflows in VS Code.

- **View mode:** Parse handler code and render an interactive flowchart.
- **Build mode:** Design workflows from scratch and generate handler boilerplate.

Supports **TypeScript/JavaScript**, **Python**, **Java**, **C# (.NET)**, **Rust**, and **Go** runtimes. SDK versions covered: JS 3.0, Python 3.0, Java 3.x, .NET 2.x, Rust 1.0 (GA), and Go 1.0 (GA).

## Install

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=gunnargrosch.durable-viz)
- [Open VSX Registry](https://open-vsx.org/extension/gunnargrosch/durable-viz) — for Kiro, Cursor, VSCodium, Gitpod, Theia, and other Open VSX consumers
- Or run `ext install gunnargrosch.durable-viz`

## Features

### View Mode

- **Interactive diagram.** See your durable function as a flowchart in a side panel.
- **Scroll zoom** and **click-drag pan**.
- **Click-to-navigate** to source lines, including from the Start and End nodes.
- **SDK coverage.** `ParallelMixed`/incremental parallel branches and custom operation subtypes are shown in the diagram, including Go 1.0 GA.
- **OpenTelemetry detection.** When a TypeScript, Python, or Java handler registers the OTel plugin, the panel shows an OTel badge and the expected span tree in the OTel tab. Click the badge to jump to the plugin registration. Imported helpers are followed, including the environment variable that selects the mode.
- **Loops.** `for`, `while`, and `foreach` loops that wrap durable calls show the loop body in a dashed box with a `next` edge back to the loop.
- **Nested operations.** Operations inside child contexts, retry blocks, and MicroVM sessions are drawn as nested subgraphs.
- **MicroVM extension.** `microvm`, `microvmSession`, and `vm.invoke` show as MicroVM nodes for TypeScript/JavaScript and Python, with session jobs inside the session container.
- **Auto-refresh** on file save.
- **Direction toggle** (TD/LR), **PNG export**, **source view** (Mermaid/JSON).

### Build Mode

- **Drag-and-drop palette** with 16 primitives filtered by language.
- **Click-to-connect edges.** Conditions auto-label `if`/`else` branches.
- **Compound nodes** for Parallel/Map with drag-to-nest.
- **Code generation** in TypeScript, Python, Java, C#, Rust, and Go.
- **Mermaid preview**, **save/load JSON**, **undo/redo**.

## Usage

| Mode | Command |
| --- | --- |
| **View** | `Durable Viz: Open Lambda Durable Function Workflow` |
| **Build** | `Durable Viz: Build Workflow Diagram` |

A toolbar button also appears in the editor title bar for `.ts`, `.js`, `.py`, `.java`, `.cs`, `.rs`, and `.go` files.

## Supported Languages

| Language | Handler detection | SDK |
| --- | --- | --- |
| TypeScript / JavaScript | `withDurableExecution()` | `@aws/durable-execution-sdk-js` |
| Python | `@durable_execution` decorator | `aws-durable-execution-sdk-python` |
| Java | `extends DurableHandler` | `aws-durable-execution-sdk-java` |
| C# (.NET) | `DurableFunction.WrapAsync` or `[DurableExecution]` | `Amazon.Lambda.DurableExecution` |
| Rust | `durable::run(handler)` | `aws-durable-execution-sdk` |
| Go | `durable.Start(handler)` | `aws-durable-execution-sdk-go` |

TypeScript/JavaScript and Python also support the Lambda MicroVM extension operations (`microvm`, `microvmSession`, and `vm.invoke`).

## Links

- [GitHub Repository](https://github.com/gunnargrosch/durable-viz)
- [AWS Lambda Durable Functions Documentation](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)

## License

MIT
