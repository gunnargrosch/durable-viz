# durable-viz

[![npm](https://img.shields.io/npm/v/durable-viz)](https://www.npmjs.com/package/durable-viz)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version/gunnargrosch.durable-viz.svg)](https://marketplace.visualstudio.com/items?itemName=gunnargrosch.durable-viz)
[![Open VSX](https://img.shields.io/open-vsx/v/gunnargrosch/durable-viz)](https://open-vsx.org/extension/gunnargrosch/durable-viz)
[![CI](https://github.com/gunnargrosch/durable-viz/actions/workflows/ci.yml/badge.svg)](https://github.com/gunnargrosch/durable-viz/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Visualize and build [AWS Lambda Durable Functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) workflows. Turn your handler code into a flowchart, or design a workflow from scratch and generate boilerplate code — no deployment or execution required.

Supports **TypeScript/JavaScript**, **Python**, **Java**, **C# (.NET)**, **Rust**, and **Go** runtimes. SDK versions covered: JS 3.0, Python 3.0, Java 3.x, .NET 2.x, Rust 1.0 (GA), and Go 1.0 (GA).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/order-parallel-dark.png">
    <img src="docs/order-parallel-light.png" alt="Flowchart of an order workflow: validate the order, run four invoke calls in parallel (inventory, payment, fraud screening, shipping quote), then confirm" width="880">
  </picture>
</p>

Read the [blog post](https://dev.to/gunnargrosch/visualizing-aws-lambda-durable-function-workflows-with-durable-viz-1838) for a walkthrough of the View mode with examples.

## Table of Contents

- [Quick Start](#quick-start)
- [VS Code Extension](#vs-code-extension)
- [CLI Reference](#cli-reference)
- [Supported Primitives](#supported-primitives)
- [How It Works](#how-it-works)
- [Examples](#examples)
- [Project Structure](#project-structure)
- [Limitations](#limitations)
- [Contributing](#contributing)
- [License](#license)

## Quick Start

Run the CLI against any file containing a durable function handler:

```shell
npx durable-viz examples/order-workflow.ts --open
```

This parses the handler, extracts the workflow structure, and opens an interactive diagram in your browser.

To use the **Build mode** workflow designer, install the [VS Code extension](#vs-code-extension) and run **Durable Viz: Build Workflow Diagram** from the command palette.

Try the included examples:

```shell
# TypeScript
npx durable-viz examples/order-workflow.ts --open
npx durable-viz examples/order-workflow-config.ts --open
npx durable-viz examples/microvm.ts --open
npx durable-viz examples/order-batch-loop.ts --open
npx durable-viz examples/order_workflow_otel.ts --open

# Python
npx durable-viz examples/order_processor.py --open
npx durable-viz examples/microvm.py --open
npx durable-viz examples/order_processor_with_retry.py --open
npx durable-viz examples/order_batch_loop.py --open
npx durable-viz examples/order_processor_otel.py --open

# Java
npx durable-viz examples/OrderProcessor.java --open
npx durable-viz examples/OrderProcessorFutures.java --open
npx durable-viz examples/OrderBatchLoop.java --open
npx durable-viz examples/OrderProcessorOtel.java --open

# C# (.NET)
npx durable-viz examples/OrderWorkflow.cs --open
npx durable-viz examples/OrderProcessor.cs --open
npx durable-viz examples/OrderBatchLoop.cs --open

# Rust
npx durable-viz examples/order_workflow.rs --open
npx durable-viz examples/order_workflow_config.rs --open
npx durable-viz examples/order_parallel_mixed.rs --open
npx durable-viz examples/order_batch_loop.rs --open

# Go
npx durable-viz examples/order_workflow.go --open
npx durable-viz examples/order_workflow_config.go --open
npx durable-viz examples/order_parallel_mixed.go --open
npx durable-viz examples/order_batch_loop.go --open
```

## VS Code Extension

The extension has two modes: **View** (parse handler code and render a diagram) and **Build** (design a workflow from scratch and generate boilerplate).

### Install from a Marketplace

[Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=gunnargrosch.durable-viz) or [open directly in VS Code](vscode:extension/gunnargrosch.durable-viz).

For Kiro, Cursor, VSCodium, Gitpod, Theia, and other Open VSX consumers, [install from the Open VSX Registry](https://open-vsx.org/extension/gunnargrosch/durable-viz).

You can also search **"Durable Viz"** in the Extensions panel, or run:

```shell
ext install gunnargrosch.durable-viz
```

### Install from Source

```shell
cd packages/vscode
pnpm build
npx @vscode/vsce package --no-dependencies
code --install-extension durable-viz-*.vsix
```

### Modes

| Mode | Command | Direction |
| --- | --- | --- |
| **View** | `Durable Viz: Open Lambda Durable Function Workflow` | Code → Diagram. Parses the active file and renders a Mermaid flowchart. |
| **Build** | `Durable Viz: Build Workflow Diagram` | Diagram → Code. Visual canvas for designing workflows and generating handler boilerplate. |

### View Mode Usage

1. Open a file containing a durable function handler.
2. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run **Durable Viz: Open Lambda Durable Function Workflow**.

The diagram appears in a side panel. It auto-refreshes when you save the file.

### View Mode Features

| Feature | Description |
| --- | --- |
| **Scroll zoom** | Scroll wheel to zoom in/out, zooms toward cursor |
| **Click-drag pan** | Click and drag to move around the diagram |
| **Click-to-navigate** | Click any node, including Start and End, to jump to that line in the source file |
| **Auto-refresh** | Diagram updates on file save |
| **Fit to view** | Fit button and auto-fit on open |
| **Direction toggle** | Switch between top-down (TD) and left-right (LR) layout |
| **Save PNG** | Export the diagram as a high-resolution transparent PNG |
| **Source view** | View the raw Mermaid syntax or JSON graph |

### Build Mode

Build mode is a visual workflow designer that runs in a VS Code webview panel. It does not require a source file — the canvas is blank when you start.

#### Workflow

- Drag durable primitives from the palette onto an interactive canvas
- Connect nodes by clicking them in sequence to create edges. Conditions auto-label `if`/`else` branches.
- Both branches can converge on the same node (convergence) and continue after the if/else
- Nest steps inside **Parallel** and **Map** nodes (drag onto the compound parent)
- Double-click any node to rename it with an inline input
- Right-click a node or edge to delete it
- Select a target language from the palette dropdown
- Click **Generate Code** for boilerplate handler code in your chosen language

Generated code opens in a new editor tab. The palette language selector filters the available primitives and determines the output language.

#### Features

| Feature | Description |
| --- | --- |
| **Drag-and-drop palette** | 16 durable primitives, filtered by language (TS/Python/Java/C#/Rust/Go) |
| **Interactive canvas** | Click-to-connect edges, drag to reposition nodes |
| **Compound nodes** | Parallel and Map nodes can contain child branches |
| **Inline rename** | Double-click any node to rename in-place (no prompt dialogs) |
| **Delete** | Remove nodes and edges via right-click context menu or <kbd>Del</kbd> key |
| **Undo/redo** | <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> for full edit history |
| **Code generation** | Generate handler boilerplate in TypeScript, Python, Java, C#, Rust, or Go |
| **Condition support** | Auto-labeled if/else edges, convergence detection, nested conditions |
| **Mermaid preview** | Overlay panel showing a Mermaid diagram of the current canvas |
| **Save/load** | Save the canvas as a JSON file and reload it later |
| **Export PNG** | Export the canvas as a high-resolution transparent PNG |
| **Auto-arrange** | Automatic layout algorithm to untangle the graph |

The extension activates for `.ts`, `.js`, `.py`, `.java`, `.cs`, `.rs`, and `.go` files. A toolbar button also appears in the editor title bar for these file types.

## CLI Reference

```
Usage: durable-viz [options] <file>

Arguments:
  file                  Path to a durable function handler file

Options:
  -d, --direction <dir> Graph direction: TD (top-down) or LR (left-right) (default: "TD")
  -n, --name <name>     Override the workflow name
  --json                Output the raw workflow graph as JSON
  -o, --open            Open the diagram in your browser
  -V, --version         Output the version number
  -h, --help            Display help
```

### Output Formats

**Mermaid** (default) prints Mermaid flowchart syntax to stdout. Paste into GitHub Markdown, Notion, or any Mermaid-compatible renderer.

```shell
durable-viz handler.ts
```

**Browser** generates a self-contained HTML file and opens it. Includes zoom controls, a legend, and light and dark themes that follow your OS setting.

```shell
durable-viz handler.ts --open
```

**JSON** outputs the raw workflow graph (nodes, edges, source lines) for custom tooling.

```shell
durable-viz handler.ts --json
```

## Supported Primitives

The parser detects all durable execution SDK primitives.

| Primitive | TypeScript | Python | Java | C# (.NET) | Rust | Go |
| --- | --- | --- | --- | --- | --- | --- |
| Step | `context.step()` | `context.step()` | `ctx.step()` | `ctx.StepAsync()` | `ctx.step()` | `durable.Step()` |
| Invoke | `context.invoke()` | `context.invoke()` | `ctx.invoke()` | `ctx.InvokeAsync()` | `ctx.invoke()` | `durable.Invoke()` |
| Parallel | `context.parallel()` | `context.parallel()` | `ctx.parallel()` | `ctx.ParallelAsync()` | `ctx.parallel()` | `durable.Parallel()` |
| Map | `context.map()` | `context.map()` | `ctx.map()` | `ctx.MapAsync()` | `ctx.map()` | `durable.Map()` |
| Wait | `context.wait()` | `context.wait()` | `ctx.wait()` | `ctx.WaitAsync()` | `ctx.wait()` | `durable.Wait()` |
| Wait for Callback | `context.waitForCallback()` | `context.wait_for_callback()` | `ctx.waitForCallback()` | `ctx.WaitForCallbackAsync()` | `ctx.wait_for_callback()` | `durable.WaitForCallback()` |
| Create Callback | `context.createCallback()` | `context.create_callback()` | `ctx.createCallback()` | `ctx.CreateCallbackAsync()` | `ctx.create_callback()` | `durable.CreateCallback()` |
| Wait for Condition | `context.waitForCondition()` | `context.wait_for_condition()` | `ctx.waitForCondition()` | `ctx.WaitForConditionAsync()` | `ctx.wait_for_condition()` | `durable.WaitForCondition()` |
| Child Context | `context.runInChildContext()` | `context.run_in_child_context()` | `ctx.runInChildContext()` | `ctx.RunInChildContextAsync()` | `ctx.run_in_child_context()` | `durable.RunInChildContext()` |
| With Retry | `withRetry(context, ...)` | `with_retry(context, ...)` | `ctx.withRetry(...)` | via `StepConfig` | `ctx.with_retry()` | `durable.Retry()` |
| MicroVM | `microvm()`, `microvmSession()` | `microvm()`, `microvm_session()` | — | — | — | — |

TypeScript also detects `context.promise.all()`, `context.promise.any()`, `context.promise.race()`, and `context.promise.allSettled()`, plus `microvm` calls inside `context.map` callbacks.

TypeScript/JavaScript and Python also detect the MicroVM extension operations. `microvm` is one job in a new MicroVM. `microvmSession` is one MicroVM shared by several `vm.invoke` jobs, drawn as a container with the session handler's operations inside it. The extension's internal callback, launch, request, and terminate steps are hidden.

Java also detects `DurableFuture.allOf(futures...)` and `DurableFuture.anyOf(futures...)` as promise combinators, plus the async operation variants (`stepAsync`, `waitAsync`, `invokeAsync`, `runInChildContextAsync`, `mapAsync`, `waitForCallbackAsync`, `waitForConditionAsync`, `withRetryAsync`).

Rust also detects `ctx.parallel_mixed()` with its `BranchSet` branches, the concurrency combinators `ctx.join_all()`, `ctx.try_join_all()`, `ctx.select_ok()`, and `ctx.race()`, plus the `.future()` and `.spawn()` builder modifiers.

Go (GA v1.0) also detects `durable.ParallelMixed()` with its `NewTypedBranch` branches, `durable.All()`, `durable.AllSettled()`, `durable.Any()`, `durable.Race()`, `durable.Join()`, and `durable.Select()`, the concurrent child context `durable.Go()`, and the `StepAsync`/`InvokeAsync`/`WaitAsync`/`RunInChildContextAsync` variants.

### Config-Level Features

The parser extracts configuration metadata and displays it as annotations on diagram nodes:

| Feature | TypeScript | Python | Java | C# | Rust | Go |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| Nesting type (`FLAT`/`NESTED`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Completion config | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Step semantics (`AtMostOncePerRetry`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tenant isolation (`tenantId`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Custom subtype (`subType`) | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Concurrency limit (`maxConcurrency`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### OpenTelemetry instrumentation

When a handler registers the OpenTelemetry plugin in source, durable-viz marks the diagram with an `OTel` badge and opens an OTel tab with the expected span tree. Click the badge to jump to the plugin registration in the handler. The tree includes the Workflow or Invocation root, operation spans, retry attempt spans, branch children, and warnings for unnamed or duplicate operation names.

It detects the code-based registrations for the SDKs that ship an OTel plugin:

| Runtime | Detected registrations |
| --- | --- |
| TypeScript / JavaScript | `createOtelPluginFactory()`, `createExecutionOtelPluginFactory()`, `createInvocationOtelPluginFactory()`, including helpers such as `plugins: loadOtelPlugins()` |
| Python | `create_otel_plugin_factory()`, `ExecutionOtelPluginFactory`, `InvocationOtelPluginFactory`, and their exported singleton factories, including helpers |
| Java | `OtelPlugin.factory()`, `ExecutionOtelPlugin.factory()`, `InvocationOtelPlugin.factory()`, including helper methods passed to `withPlugins()` |

For TypeScript/JavaScript and Python, durable-viz follows imported helper files. For Java, it follows helper methods in the same file and imported helper classes. A helper such as `plugins: loadOtelPlugins()` reports the modes it can select and the environment variable that chooses between them.

Durable-viz reads the handler source and imported helpers only. A plugin selected through `DURABLE_EXECUTION_PLUGINS`, a Lambda layer, or deployment configuration does not show up unless the handler code references the plugin. When a helper selects the mode at runtime, the badge shows `OTel: env`, its tooltip names the environment variable and the modes it can choose, and the OTel tab lists the operation spans without assuming the Workflow or Invocation root.

### Nested operations

Operations inside `runInChildContext`, retry blocks, and MicroVM sessions are drawn as a compound dashed subgraph. The container connects to its first body operation with a dashed edge, and the solid workflow flow exits from the last nested operation. The OTel tab shows the same nesting in the expected span tree. Click any nested node to jump to its source line.

### Visual Encoding

In the VS Code View mode and the browser page, every node is drawn as a card. Each card has an icon and a kind label, and the color is only an accent on the icon. Start and End are yellow circles. Cards follow your VS Code theme in the extension and your OS color scheme in the browser.

In the Mermaid output, each primitive type has a distinct shape and color:

| Node | Shape | Color |
| --- | --- | --- |
| Start / End | Stadium | Blue |
| Step | Rectangle | Green |
| Invoke | Trapezoid | Amber |
| Parallel / Map / Promise Combinators | Hexagon | Purple |
| Wait / Callback | Circle | Red |
| Condition | Diamond | Indigo |
| Loop | Rounded rectangle, body in a dashed box | Olive |
| Child Context / With Retry | Subroutine | Teal |
| MicroVM | Subroutine | Terracotta |

Config-level details (nesting type, completion rules, step semantics, tenant isolation, custom subtypes) are shown as annotations below the node label.

## How It Works

The tool performs static analysis on your source file. It never imports, executes, or deploys your code.

### TypeScript / JavaScript

Uses [ts-morph](https://github.com/dsherret/ts-morph) to parse the AST. Finds `withDurableExecution()` calls, walks the handler body, and extracts durable primitives with their names, options, and source locations. It also resolves imported `microvm` and `microvmSession` calls, aliases, inline session handlers, and named handler references.

**Advanced features** (TypeScript only):

- **Function-reference following.** If the handler calls a helper function that accepts `DurableContext`, the parser resolves it and inlines its durable calls at the call site.
- **Registry key resolution.** For dynamic `context.parallel()` calls using `.map()` over a registry object (like a specialist map), the parser enumerates the registry keys to show all possible parallel branches.

### Python

Regex-based parser. Finds `@durable_execution` decorated handlers and extracts `context.<method>()` calls with their `name=` keyword arguments. Also detects the standalone `with_retry()` function and extracts config-level metadata (nesting type, completion config, step semantics, tenant isolation) from both keyword arguments and dict-style configs. It resolves imported `microvm` and `microvm_session` calls, import aliases, and named session handlers.

### Java

Regex-based parser. Finds classes extending `DurableHandler` and extracts `ctx.<method>()` calls from the `handleRequest` method with their string literal names. Detects `DurableFuture.allOf()` and `DurableFuture.anyOf()` static calls as promise combinators, and extracts config-level metadata from builder-pattern configs (nesting type, completion config, step semantics, tenant isolation).

### C# (.NET)

Regex-based parser. Finds `DurableFunction.WrapAsync` calls to locate the workflow function, then extracts `ctx.<Method>Async()` calls from the workflow body. Supports both the **executable** model (`Main` + `LambdaBootstrap`) and the **class-library** model (`[assembly: LambdaSerializer]`), plus the **Annotations** model (`[DurableExecution]` attribute on a method with an `IDurableContext` parameter). Extracts names from `name:` named arguments, custom `SubType` labels, and both `DurableBranch<T>` and incremental `CreateParallel().Branch<T>()` patterns for parallel branches. Handles Allman-style braces (common C# convention) for `if`/`else` condition detection. When the workflow method lives in another file, the parser resolves the class from the project tree, and click-to-navigate opens that file.

### Rust

Regex-based parser. Finds `durable::run(handler)` entry points (also `run_with_options` and `wrap`), resolves the `use aws_durable_execution_sdk as <alias>;` crate alias, and extracts the fluent builder chain: `ctx.step(..).name("greet").await?` (SDK 1.0). Handles rustfmt's split style (`ctx` on one line, `.step(` on the next) and the turbofish generics on `invoke::<T>`. Names are resolved in layers: string literal, local `let` constant propagation, then identifier fallback. Branch names come from `Branch::new("name", ..)` and `BranchSet::add("name", ..)`, `.sub_type(...)` labels are shown as annotations, `.virtual_context()` marks a child context or retry block with no record of its own, and the concurrency combinators `join_all`, `try_join_all`, `select_ok`, and `race` map to the promise-combinator kinds.

### Go

Regex-based parser for the GA Go SDK. Finds `durable.Start(handler)` (also `durable.Wrap`) entry points, resolves the SDK import alias, and extracts the package-level generic calls. The operation name is the second argument — `durable.Step(ctx, "greet", ...)` — so names come straight from the string literal, with local `const`/`:=` string-constant propagation and identifier fallback. Structural scanning runs over a length-preserving mask of the source with string, rune, and comment contents blanked, so durable-looking text inside them is ignored and delimiters cannot confuse brace/paren matching; nested generic type arguments (`durable.Invoke[map[string][]string, any](...)`) are handled too. Multi-line calls are balanced, so durable operations nested inside a branch or map callback are attributed to that compound node rather than the top level. Branch names come from `durable.Branch[T]{Name: "..."}` literals and `durable.NewTypedBranch("...")` calls for `ParallelMixed`; map callbacks are summarized as an `each item` branch containing their inner operations. `WithStepSubType`, `WithCallbackSubType`, and `WithChildSubType` labels are shown as annotations. `Go` maps to a child context, and `All`, `AllSettled`, `Any`, `Race`, `Join`, and `Select` map to the promise-combinator kinds. Go initializer-style `if` statements (`if x, err := f(); err != nil`) are skipped so ordinary error handling is not mistaken for a workflow condition.

### Conditionals

All parsers detect `if` statements that wrap durable calls and represent them as condition (diamond) nodes in the graph. When the `if` block ends with a `return`, the "yes" branch connects to End instead of falling through.

### Loops

All parsers detect loops that wrap durable calls: `for`, `for...of`/`for...in`, `while`, and `do...while` in TypeScript, Java, and C# (plus `foreach`), `for`, `while`, and `async for` in Python, `for`, `while`, `while let`, and `loop` (including labeled loops) in Rust, and every `for` form in Go (`for {`, `for cond {`, three-clause, and `range`). A loop becomes a loop node with its body in a dashed box. A dashed `next` edge returns from the last body operation to the loop node, and a `done` edge leaves it. Conditions, parallel nodes, and other loops inside the body work as usual.

When the iteration count is a plain literal (`for (let i = 0; i < 3; i++)`, `range(3)`, `0..3`, `for range 3`) the label shows it, for example `loop: attempt < 3 x3`. Loops without durable calls in their body are left out, the same as `if` statements.

## Examples

The `examples/` directory contains sample handlers for each language:

| File | Language | Primitives |
| --- | --- | --- |
| `order-workflow.ts` | TypeScript | step, parallel, invoke, waitForCallback, condition |
| `order-workflow-config.ts` | TypeScript | step, parallel, map, invoke, runInChildContext, withRetry, config features |
| `microvm.ts` | TypeScript | microvm, microvmSession, vm.invoke, wait |
| `order-batch-loop.ts` | TypeScript | step, wait, waitForCallback, condition, loop |
| `order_workflow_otel.ts` | TypeScript | step, waitForCallback, OTel plugin registration |
| `order_processor.py` | Python | step, wait, create_callback, invoke, condition |
| `order_processor_with_retry.py` | Python | step, parallel, map, invoke, withRetry, config features |
| `microvm.py` | Python | microvm, microvm_session, vm.invoke, wait |
| `order_batch_loop.py` | Python | step, wait, waitForCallback, condition, loop |
| `order_processor_otel.py` | Python | step, waitForCallback, OTel plugin registration |
| `OrderProcessor.java` | Java | step, parallel, wait, invoke, waitForCallback, condition |
| `OrderProcessorFutures.java` | Java | step, parallel, map, invoke, runInChildContext, withRetry, allOf, anyOf, config features |
| `OrderBatchLoop.java` | Java | step, wait, waitForCallback, condition, loop |
| `OrderProcessorOtel.java` | Java | step, wait, waitForCallback, OTel plugin registration |
| `OrderWorkflow.cs` | C# | step, parallel, wait, waitForCallback, condition |
| `OrderProcessor.cs` | C# | step, parallel, wait, invoke, waitForCallback, condition |
| `OrderBatchLoop.cs` | C# | step, wait, waitForCallback, condition, loop |
| `order_workflow.rs` | Rust | step, parallel, wait, waitForCallback, condition, subtypes, maxConcurrency |
| `order_workflow_config.rs` | Rust | step, invoke, map, runInChildContext, withRetry, waitForCondition, createCallback, race, config features |
| `order_parallel_mixed.rs` | Rust | parallel_mixed with BranchSet, step, subtypes |
| `order_batch_loop.rs` | Rust | step, wait, waitForCallback, condition, loop |
| `order_workflow.go` | Go | step, parallel, wait, waitForCallback, condition |
| `order_workflow_config.go` | Go | step, invoke, map, runInChildContext, withRetry, waitForCondition, combinators, config features |
| `order_parallel_mixed.go` | Go | ParallelMixed with NewTypedBranch, step, wait, waitForCallback, subtypes |
| `order_batch_loop.go` | Go | step, wait, waitForCallback, condition, loop |

```shell
npx durable-viz examples/order-workflow.ts --open
```

## Project Structure

```
durable-viz/
  packages/
    core/                         # Parser + graph model + renderers
      src/
        parser.ts                 # Parser interface + dispatch by extension
        parsers/
          typescript.ts           # TypeScript/JS parser (ts-morph AST)
          python.ts               # Python parser (regex)
          java.ts                 # Java parser (regex)
          csharp.ts               # C# parser (regex)
          rust.ts                 # Rust parser (regex)
          go.ts                   # Go parser (regex)
          c-style-loops.ts        # Loop header parsing shared by Java and C#
        graph.ts                  # WorkflowGraph model + edge builder
        renderers/
          mermaid.ts              # Mermaid flowchart renderer
          codegen.ts              # Handler code generation (TS/Python/Java/C#/Rust/Go)
        index.ts                  # Public API
    cli/                          # npx CLI
      src/
        bin.ts                    # CLI entry point + browser HTML template
    vscode/                       # VS Code extension
      src/
         extension.ts              # Webview panels for View and Build modes
  examples/                       # Sample handlers for each language
  pnpm-workspace.yaml
  tsconfig.base.json
```

### Architecture

The core package is language-agnostic above the parser layer. Adding a new language means implementing the `Parser` interface (two methods: `extensions` and `parseFile`). The graph model, edge builder, and all renderers are shared.

```
View Mode:   [source file] → Parser → WorkflowGraph → Renderer → [diagram / JSON]
Build Mode:  [canvas] → cyToWorkflowGraph() → WorkflowGraph → generateCode() → [boilerplate]
                              │                          │
                      TS / Python / Java / C# / Rust / Go   Mermaid / JSON / Code
```

## Limitations

- **Same-file only.** Function-reference following resolves functions defined in the same file. Imported helpers from other files are not followed.
- **Static analysis.** The parser sees all possible paths, not a specific execution. Dynamic parallel branches (from `.map()`) show all registered targets, even if a given execution only uses a subset.
- **Mermaid rendering.** Arrow routing for fan-in (multiple edges converging on one node) is controlled by Mermaid's layout engine. Complex workflows with many parallel branches may have overlapping edges.
- **Loops show structure, not control flow.** `break`, `continue`, and `else` clauses are not drawn. Loop bodies written without braces, one-line bodies (`for x in y: step()`), and iteration through callbacks (`forEach`, `.map`, `for_each`, LINQ) are not detected as loops.
- **Python/Java/C# parsers are regex-based.** They handle standard patterns well but may miss unusual formatting (e.g., method calls split across many lines with comments between arguments).
- **MicroVM support is TypeScript/JavaScript and Python only.** The diagram shows the user-level `microvm`, `microvmSession`, and `vm.invoke` operations. It does not expand the extension's internal callback, launch, request, or terminate steps.

## Contributing

Contributions are welcome. To set up the development environment:

```shell
git clone https://github.com/gunnargrosch/durable-viz.git
cd durable-viz
pnpm install
pnpm build
```

Run the CLI locally:

```shell
node packages/cli/dist/bin.js examples/order-workflow.ts --open
```

Test the VS Code extension by pressing `F5` in the `packages/vscode` directory to launch the Extension Development Host.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes.

## License

MIT
