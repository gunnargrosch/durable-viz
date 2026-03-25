# durable-viz

[![npm](https://img.shields.io/npm/v/durable-viz)](https://www.npmjs.com/package/durable-viz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Visualize [AWS Lambda Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) workflows. Static analysis turns your handler code into a flowchart, no deployment or execution required.

Supports **TypeScript/JavaScript**, **Python**, and **Java** runtimes.

```mermaid
graph LR
  node_start([Start])
  step_1[validate]
  parallel_2{{prepare}}
  subgraph sub_parallel_2[" "]
    invoke_3[/check-inventory\]
    invoke_4[/reserve-payment\]
  end
  style sub_parallel_2 fill:transparent,stroke:#444,stroke-width:1px,stroke-dasharray:5 5
  step_5[fulfill]
  cond_6{approval?}
  callback_7((wait))
  node_end([End])
  node_start --> step_1
  step_1 --> parallel_2
  parallel_2 --> invoke_3
  parallel_2 --> invoke_4
  invoke_3 --> step_5
  invoke_4 --> step_5
  step_5 --> cond_6
  cond_6 -->|yes| callback_7
  cond_6 -->|no| node_end
  callback_7 --> node_end
  style node_start fill:#5b8ab4,stroke:#4a7293,color:#e8edf2
  style step_1 fill:#4a8c72,stroke:#3d7360,color:#e0efe8
  style parallel_2 fill:#7b6b9e,stroke:#655883,color:#e8e3f0
  style invoke_3 fill:#b8873a,stroke:#967032,color:#f5edd8
  style invoke_4 fill:#b8873a,stroke:#967032,color:#f5edd8
  style step_5 fill:#4a8c72,stroke:#3d7360,color:#e0efe8
  style cond_6 fill:#6b71a8,stroke:#575c8a,color:#e3e4f0
  style callback_7 fill:#b05a5a,stroke:#8f4a4a,color:#f2e0e0
  style node_end fill:#5b8ab4,stroke:#4a7293,color:#e8edf2
```

## Quick Start

```shell
npx durable-viz handler.ts --open
```

This parses the handler, extracts the workflow structure, and opens an interactive diagram in your browser with scroll zoom, click-drag panning, direction toggle, source view, and a dark theme.

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

Java SDK support is in preview with some primitives still in development.

| Primitive | TypeScript | Python | Java (preview) |
| --- | --- | --- | --- |
| Step | `context.step()` | `context.step()` | `ctx.step()` |
| Invoke | `context.invoke()` | `context.invoke()` | `ctx.invoke()` |
| Parallel | `context.parallel()` | `context.parallel()` | *in development* |
| Map | `context.map()` | `context.map()` | *in development* |
| Wait | `context.wait()` | `context.wait()` | `ctx.wait()` |
| Wait for Callback | `context.waitForCallback()` | `context.wait_for_callback()` | *in development* |
| Create Callback | `context.createCallback()` | `context.create_callback()` | `ctx.createCallback()` |
| Wait for Condition | `context.waitForCondition()` | `context.wait_for_condition()` | *in development* |
| Child Context | `context.runInChildContext()` | `context.run_in_child_context()` | `ctx.runInChildContext()` |

## VS Code Extension

Also available as a VS Code extension with an interactive side panel, click-to-navigate, and auto-refresh on save.

[Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=gunnargrosch.durable-viz)

## Links

- [GitHub Repository](https://github.com/gunnargrosch/durable-viz)
- [AWS Lambda Durable Functions Documentation](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html)

## License

MIT
