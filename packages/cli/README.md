# durable-viz

[![npm](https://img.shields.io/npm/v/durable-viz)](https://www.npmjs.com/package/durable-viz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Static analysis for [AWS Lambda Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) workflows. Parses handler code and renders an interactive flowchart — no deployment or execution required.

Supports **TypeScript/JavaScript**, **Python**, **Java**, **C# (.NET)**, and **Rust** runtimes.

## Quick Start

```shell
npx durable-viz handler.ts --open
```

Opens an interactive diagram in your browser with scroll zoom, click-drag panning, direction toggle, source view, PNG export, and a dark theme.

## Usage

```
Usage: durable-viz [options] <file>

Arguments:
  file                   Path to a durable function handler file

Options:
  -d, --direction <dir>  Graph direction: TD (top-down) or LR (left-right) (default: "TD")
  -n, --name <name>      Override the workflow name
  --json                 Output the raw workflow graph as JSON
  -o, --open             Open the diagram in your browser
  -V, --version          Output the version number
  -h, --help             Display help
```

## Output Formats

**Mermaid** (default) prints Mermaid flowchart syntax to stdout. Paste into GitHub Markdown, Notion, or any Mermaid-compatible renderer.

```shell
durable-viz handler.ts
```

**Browser** generates a self-contained HTML file and opens it.

```shell
durable-viz handler.ts --open
```

**JSON** outputs the raw workflow graph for custom tooling.

```shell
durable-viz handler.ts --json
```

## Supported Primitives

| Primitive | TypeScript | Python | Java | C# (.NET) | Rust |
| --- | --- | --- | --- | --- | --- |
| Step | `context.step()` | `context.step()` | `ctx.step()` | `ctx.StepAsync()` | `ctx.step()` |
| Invoke | `context.invoke()` | `context.invoke()` | `ctx.invoke()` | `ctx.InvokeAsync()` | `ctx.invoke()` |
| Parallel | `context.parallel()` | `context.parallel()` | `ctx.parallel()` | `ctx.ParallelAsync()` | `ctx.parallel()` |
| Map | `context.map()` | `context.map()` | `ctx.map()` | `ctx.MapAsync()` | `ctx.map()` |
| Wait | `context.wait()` | `context.wait()` | `ctx.wait()` | `ctx.WaitAsync()` | `ctx.wait()` |
| Wait for Callback | `context.waitForCallback()` | `context.wait_for_callback()` | `ctx.waitForCallback()` | `ctx.WaitForCallbackAsync()` | `ctx.wait_for_callback()` |
| Create Callback | `context.createCallback()` | `context.create_callback()` | `ctx.createCallback()` | `ctx.CreateCallbackAsync()` | `ctx.create_callback()` |
| Wait for Condition | `context.waitForCondition()` | `context.wait_for_condition()` | `ctx.waitForCondition()` | `ctx.WaitForConditionAsync()` | `ctx.wait_for_condition()` |
| Child Context | `context.runInChildContext()` | `context.run_in_child_context()` | `ctx.runInChildContext()` | `ctx.RunInChildContextAsync()` | `ctx.run_in_child_context()` |
| With Retry | `withRetry(context, ...)` | `with_retry(context, ...)` | `ctx.withRetry(...)` | via `StepConfig` | `ctx.with_retry()` |

TypeScript also supports `context.promise.all()`, `context.promise.any()`, `context.promise.race()`, and `context.promise.allSettled()`.

Java also supports `DurableFuture.allOf(futures...)` and `DurableFuture.anyOf(futures...)`.

Rust also supports the concurrency combinators `ctx.join_all()`, `ctx.try_join_all()`, `ctx.select_ok()`, and `ctx.race()`, plus the `.future()` and `.spawn()` builder modifiers.

## Visual Encoding

| Node | Shape | Color |
| --- | --- | --- |
| Start / End | Stadium | Blue |
| Step | Rectangle | Green |
| Invoke | Trapezoid | Amber |
| Parallel / Map | Hexagon | Purple |
| Wait / Callback | Circle | Red |
| Condition | Diamond | Indigo |
| Child Context / With Retry | Subroutine | Teal |

## Build Mode

For visual workflow design with code generation, use the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=gunnargrosch.durable-viz) and run **Durable Viz: Build Workflow Diagram**.

## Links

- [GitHub Repository](https://github.com/gunnargrosch/durable-viz)
- [AWS Lambda Durable Functions Documentation](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)

## License

MIT
