# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.14.0] - 2026-11-25

### Changed

- **New look for View mode.** The VS Code panel and the CLI `--open` page now draw nodes as dark cards with a line icon, a kind label and the node name. Start and End are yellow circles, parallel, loop and nested bodies sit in thin rounded containers, edge labels are boxed, and the legend uses the node icons.
- The diagram follows your theme. In VS Code, colors derive from the editor theme, and the diagram re-renders when you switch between light and dark. In the browser it follows the OS color scheme.
- Save PNG exports the styled diagram with a solid background and a 24px margin. Before, the export lost the page styles and clipped the labels.
- New extension icon, exported at 256x256.
- The README opens with an image of the View mode in place of a Mermaid block, with light and dark versions.
- The Source tab still shows the classic Mermaid text, so it pastes into READMEs and GitHub.

### Added

- `renderMermaid` accepts `style: 'card'`. The default `classic` output is unchanged.
- `examples/order-parallel.ts`, a short workflow with a parallel step.

### Notes

- Build mode keeps its current look.

## [0.13.0] - 2026-11-25

### Added

- **Nested operations in child contexts and retry blocks.** TypeScript/JavaScript, Python, Java, C#, Rust, and Go now attach operations inside `runInChildContext` and retry bodies. The diagram draws each container and its body in one compound dashed subgraph, with the solid workflow flow passing through the nested operations.
- The OTel tab includes nested operations in the expected span tree.

### Changed

- The VS Code extension now bundles the repo changelog in the VSIX, so the Open VSX changes page shows release notes.
- Updated the repo, CLI, and VS Code READMEs for nested operations and the compound subgraph layout.

## [0.12.2] - 2026-11-23

### Added

- Java operation coverage now includes every async variant: `stepAsync`, `waitAsync`, `invokeAsync`, `runInChildContextAsync`, `mapAsync`, `waitForCallbackAsync`, `waitForConditionAsync`, and `withRetryAsync`.
- Java code generation now emits `DurableFuture.allOf` and `DurableFuture.anyOf`.
- Python now parses the functional `handler = durable_execution(handler_fn)` entry point.
- TypeScript now resolves named handlers passed to `withDurableExecution(handler)`.
- C# now resolves workflows defined in another file, including `DurableFunction.WrapAsync(SomeClass.Method, ...)`. Click-to-navigate opens the workflow file.

### Fixed

- C# workflow signatures with nullable, array, and nested generic types now parse.
- Java `invokeAsync` now extracts the target function instead of the operation name.

### Changed

- Updated the repo and CLI READMEs with the Java async variants and C# multi-file behavior.

## [0.12.1] - 2026-11-23

### Changed

- Removed the per-node `span <name>` annotation from diagrams. Named operations already show the span name in the node label. The OTel tab keeps the span tree, attempt spans, branch children, and warnings for unnamed or duplicate names.
- Updated the repo, CLI, and VS Code READMEs to describe the badge and OTel tab without the redundant node annotation.

## [0.12.0] - 2026-11-23

### Added

- **OpenTelemetry detection.** TypeScript/JavaScript, Python, and Java handlers that register the OTel plugin now show an `OTel` badge, a `span <name>` annotation on each operation, and an OTel tab with the expected span tree. The tree includes the Workflow or Invocation root, attempt spans, branch children, and warnings for unnamed or duplicate operation names.
- Imported helper resolution. TypeScript/JavaScript and Python follow imported helper files. Java follows same-file helper methods and imported helper classes. When a helper selects the view at runtime, the badge shows `OTel: env` and its tooltip names the environment variable and possible modes.
- New examples: `order_workflow_otel.ts`, `order_processor_otel.py`, and `OrderProcessorOtel.java`.

### Changed

- The OTel badge navigates to the plugin registration line in the handler.
- Updated the repo, CLI, and VS Code READMEs with OTel detection, helper resolution, and the badge behavior.

### Fixed

- The OTel badge label no longer wraps inside the pill in a narrow panel.

## [0.11.0] - 2026-11-20

### Added

- **Rust SDK GA (v1.0.0) support.** Updated the Rust examples, parser documentation, and generated handler for the GA crate. Generated handlers now use `durable::init_default_subscriber()?`, and flat child contexts and `with_retry` blocks emit `.virtual_context()`.
- Rust parser detects `.virtual_context()` on `run_in_child_context` and `with_retry` and renders the node as flat, matching the virtual-context behavior of the GA SDK.

### Changed

- Updated the repo, CLI, and VS Code READMEs to list Rust 1.0 (GA) and the GA builder API.
- Rust code generation emits the single type parameter of GA's `ctx.invoke::<O>(...)` and the two-argument `with_retry` closure required by the SDK.
- The Rust examples use GA's `RetryDecision::retry(...)` constructor for non-exhaustive retry decisions.

### Fixed

- Clicking the End node navigated one row past the handler's last statement in every language: brace-delimited handlers landed on the closing brace (or a blank line before it), and Python landed on the blank line after the body. End now resolves to the last non-empty line inside the handler for TypeScript, Python, Java, C#, Rust, and Go (TypeScript uses the last statement's end line).

## [0.10.0] - 2026-11-16

### Added

- **Go SDK GA (v1.0.0) support.** Updated the Go examples and code generation for the GA SDK. Go code generation now emits a required `WaitStrategy` for `WaitForCondition`; a nil strategy is rejected at the call in v1.0.
- **`ParallelMixed` support.** Go `durable.ParallelMixed()` with `NewTypedBranch` branches and Rust `ctx.parallel_mixed()` with `BranchSet` branches render as parallel nodes with their named branches. The C# incremental `ctx.CreateParallel().Branch<T>()` API is also detected.
- **Custom operation subtypes.** TypeScript `subType`, Python `sub_type`, C# `SubType`, Rust `.sub_type(...)`, and Go `WithStepSubType`/`WithCallbackSubType`/`WithChildSubType` are shown as annotations on the diagram. Go code generation emits the subtype options, and the new Go and Rust examples exercise them.
- **Rust SDK 0.2 examples.** Updated the examples for the single `wait_for_callback` output type parameter, the `with_retry` attempt argument, `durable::init_default_subscriber`, and subtype labels.
- New examples: `order_parallel_mixed.go` and `order_parallel_mixed.rs`.

### Changed

- Clicking the Start or End node now navigates to the handler declaration and the end of the handler, the same way as the other nodes.
- Updated the repo, CLI, and VS Code READMEs with the covered SDK versions, new examples, `ParallelMixed`, custom subtypes, and Start/End navigation.
- Updated the Java, Python, and .NET examples for the current SDK callback signatures and .NET `SubType` config. All examples now parse with the CLI.

### Fixed

- Rust and Go parser comments and documentation now describe the supported SDK versions accurately.

## [0.9.0] - 2026-10-07

### Added

- **Loop support in View mode, all six languages.** `for`, `for...of`/`for...in`, `while`, and `do...while` (TypeScript), `for`, `while`, and `async for` (Python), `for`, enhanced `for`, `while`, and `do...while` (Java), `for`, `foreach`, `while`, and `do...while` (C#, including Allman braces), `for`, `while`, `while let`, and `loop` with labels (Rust), and every `for` form including `range` (Go). A loop that wraps durable calls becomes a `loop` node; its body is drawn in a dashed box, a dashed `next` edge returns to the loop node, and a `done` edge leaves it. Conditions, parallel nodes, and other loops nest inside the body. Literal iteration counts (`i < 3`, `range(3)`, `0..3`) are shown as `x3`.
- `buildEdges` returns to the enclosing loop header from the end of a loop body, including when the body ends with a condition or a parallel node.
- A Loop entry in the legend of the extension and the CLI HTML output. Long loop headers wrap onto several lines.
- Six loop examples (`order-batch-loop.ts`, `order_batch_loop.py`, `OrderBatchLoop.java`, `OrderBatchLoop.cs`, `order_batch_loop.rs`, `order_batch_loop.go`).

### Fixed

- Go, Rust, Java, and C# skipped the statement that directly follows an `if` block when no blank line separated them, so for example a `charge` step after `if vip { ... }` disappeared from the diagram. Python was not affected.
- Source lines of operations inside an `if` block were one too high in Go, Rust, Java, and C# (Allman-style C# was already correct), so click-to-navigate landed on the next line.
- C# and Python now locate an `if` block by its own line instead of the first identical line, which matters when the same line appears more than once.
- Condition labels lost `<`, `>`, parentheses, brackets, braces, and pipes (`order.Total > 10000` showed as `order.Total 10000`, `items.iter()` as `items.iter`). Condition and loop labels are now quoted in the Mermaid output, so they appear as written.
- CLI `--version` is read from `packages/cli/package.json` at build time instead of a hardcoded string, so it can no longer drift from the released version.
- `pnpm test` in `@durable-viz/core` ran only the test files in subdirectories under `sh`, because `**` was not expanded recursively. The script now lists both levels explicitly.

### Documentation

- README: added the missing `order_workflow_config.rs` example and fixed the code generation languages in the project structure (Go was missing).

## [0.8.0] - 2026-09-23

### Added

- **Go parser** for the [AWS Durable Execution SDK for Go](https://github.com/aws/aws-durable-execution-sdk-go) (preview, module `github.com/aws/aws-durable-execution-sdk-go`). Finds `durable.Start(handler)` / `durable.Wrap(handler)` entry points, resolves the SDK import alias, and extracts the package-level generic primitives whose name is the second argument (`durable.Step(ctx, "greet", ...)`). Resolves local string constants for dynamic names, follows same-file helper functions that accept a `durable.Context`, balances parentheses across multi-line calls so nested operations stay inside their compound node, and reads branch names from `durable.Branch[T]{Name: "..."}`. Concurrency combinators (`All`, `AllSettled`, `Any`, `Race`, `Join`, `Select`) map to the promise-combinator kinds and `Go` maps to a child context.
- **Go code generation.** The builder emits a `package main` handler with `durable.Start(handler)`, per-primitive snippets, branch literals, `WithMaxConcurrency`, `WithCompletion`, `WithNesting`, `WithChildVirtual`, `WithSemantics`, `WithRetry`, and `WithTenantID`, including conditional `time` and `aws` imports.
- Two Go examples: `order_workflow.go` (basic) and `order_workflow_config.go` (config features and combinators).
- Go support in the VS Code Build-mode palette, code-generation target, and `.go` editor title activation.
- Robust Go scanning: string, rune, and comment contents are masked before structural analysis, so durable-looking text inside them is ignored and delimiters cannot confuse brace/paren matching; nested generic type arguments are handled.

## [0.7.0] - 2026-08-25

### Added

- **Rust parser** for the [AWS Durable Execution SDK for Rust](https://github.com/aws/aws-durable-execution-sdk-rust) (preview, crate `aws-durable-execution-sdk`). Detects the fluent builder API (`ctx.step(..).name("greet").await?`), resolves the `use aws_durable_execution_sdk as <alias>;` crate alias, and handles rustfmt's split style (`ctx` on one line, `.step(` on the next) plus turbofish generics. Names resolve in layers: string literal, local `let` constant propagation, identifier fallback. Concurrency combinators (`join_all`, `try_join_all`, `select_ok`, `race`) map to the promise-combinator kinds.
- **Rust code generation.** The builder now emits a full `#[tokio::main]`/`durable::run` handler with per-primitive builder snippets, including `Branch::new(...)`, `.nesting()`, `.completion()`, `.max_concurrency()`, `.tenant_id()`, `.retry_strategy()`, and the combinator calls.
- **.NET Lambda Annotations model.** C# parser now detects the `[DurableExecution]` attribute model in addition to `DurableFunction.WrapAsync`.
- **Concurrency limit (`maxConcurrency`).** Parsed across all five languages, rendered as a `concurrency N` annotation, and emitted in TypeScript, C#, and Rust codegen.
- **Promise combinators in the builder.** Four new palette primitives (Join All, Any, Race, All Settled) for TypeScript and Rust.
- **Open VSX publishing.** The release workflow publishes to the Open VSX Registry alongside the VS Code Marketplace via the `ovsx` CLI.
- **ESLint.** Added a flat ESLint config with `typescript-eslint` and a `lint` script per package, wired into CI.
- Two Rust examples: `order_workflow.rs` (basic) and `order_workflow_config.rs` (config features and combinators).

### Changed

- Updated all three READMEs (repo, CLI, extension) for Rust support, the annotations model, and `maxConcurrency`.

### Fixed

- Removed unused variables and imports surfaced by the new lint pass across `core` and `vscode`.
- CLI `--version` now reports the actual package version (was hardcoded to `0.1.3`).

## [0.6.1] - 2026-07-24

### Added

- **.NET config feature extraction.** C# parser now detects `StepSemantics.AtMostOncePerRetry` from `StepConfig` and `TenantId` from `InvokeConfig`.
- **.NET codegen for config features.** C# codegen emits `StepConfig` and `InvokeConfig` with semantics and tenant isolation when present.

### Changed

- **.NET SDK GA compatibility.** Verified all 9 primitives against the .NET Durable Execution SDK v1.0.0.
- **Updated package READMEs.** CLI and VS Code extension READMEs now list all four languages (including C#), reflect Java GA status, and document Build mode.
- **Config feature table.** Step semantics and tenant isolation now marked as supported for .NET.

### Fixed

- **Java parser:** `withRetry` is now detected in both the old standalone form (`withRetry(ctx, ...)`) and the new instance method form (`ctx.withRetry(...)`) introduced in Java SDK v2.0.0.

## [0.6.0] - 2026-07-22

### Added

- **Build mode.** A visual workflow designer in the VS Code extension. Design the diagram first, then generate handler boilerplate.
  - Drag-and-drop palette with 11 primitives filtered by language (TS/Python/Java/C#).
  - Interactive canvas with click-to-connect edges, compound nodes for Parallel/Map, inline rename, delete, undo/redo.
  - **Conditions** auto-label `if`/`else` edges, enforce edge limits (one predecessor, two outgoing), block duplicate/cross-branch edges and self-loops. Supports nested conditions and convergence (branches merging on a shared node).
  - **Code generation** via shared codegen module (`packages/core/src/renderers/codegen.ts`) with topological sort, condition if/else branching, parallel/map branch assembly, edge routing, and variable name deduplication.
  - Mermaid preview, save/load as JSON, export PNG, auto-arrange layout.
  - Compound nodes stay at fixed size with dynamically centered children that follow when the parent is dragged.
  - Arrange button stacks disconnected nodes vertically and restores children after layout.

## [0.5.0] - 2026-06-28

### Added

- **C# (.NET) parser** for the [AWS Lambda Durable Execution SDK for .NET](https://github.com/aws/aws-lambda-dotnet/issues/2418) preview (`Amazon.Lambda.DurableExecution` 0.x). Detects all durable primitives from `IDurableContext`: `StepAsync`, `WaitAsync`, `CreateCallbackAsync`, `WaitForCallbackAsync`, `WaitForConditionAsync`, `RunInChildContextAsync`, `InvokeAsync`, `ParallelAsync`, `MapAsync`.
- Supports both the **executable** programming model (`Main` + `LambdaBootstrap`) and the **class-library** model (`[assembly: LambdaSerializer]`).
- Extracts names from C# `name:` named arguments and detects `DurableBranch<T>` patterns for parallel branches.
- Handles Allman-style `if`/`else` braces (common C# convention) for condition detection.
- Supports generic type arguments in method calls (e.g., `StepAsync<T>()`, `InvokeAsync<TPayload, TResult>()`).
- Two example files: `OrderWorkflow.cs` (executable model) and `OrderProcessor.cs` (class-library model).
- 16 test cases covering all primitives and both entry-point models.
- VS Code extension activates for `.cs` files.

## [0.4.1] - 2026-06-27

### Fixed

- Mermaid edge labels used invalid `#nbsp;` instead of `&nbsp;`, causing rendering errors
- Pipe characters (`|`) in condition node labels (e.g., `||` operators) now escaped to prevent Mermaid 11 parse errors
- Duplicate nodes generated from try/catch blocks inside condition branches (switched to `getChildStatements`)
- Dynamic step names showing generic "step" label — TypeScript now handles PropertyAccessExpression, Identifier, TemplateExpression, and CallExpression; Python now extracts function references and variable `name=` arguments; Java now supports dotted identifiers, function refs, and variable refs
- Java parser now handles nested generics in class declarations and multi-line method calls
- Broken VS Code Marketplace badge replaced with shields.io

## [0.4.0] - 2026-06-27

### Added

- **Python `with_retry` support.** Detects `with_retry(context, func, config, name?)` standalone function calls (SDK v1.6.0). Previously only supported for TypeScript and Java.
- **Java `DurableFuture.allOf()` / `DurableFuture.anyOf()` support.** Detects static `DurableFuture.allOf(futures...)` and `DurableFuture.anyOf(futures...)` calls, rendered as promise combinator nodes (same as TypeScript `context.promise.all()` / `context.promise.any()`).
- **Config-level feature extraction** across all three languages:
  - `nestingType` / `NestingType.FLAT` on parallel, map, runInChildContext, and withRetry nodes
  - `completionConfig` / completion rules (firstSuccessful, allCompleted, etc.) on parallel and map nodes
  - `stepSemantics` / `StepSemantics.AT_MOST_ONCE_PER_RETRY` on step nodes
  - `tenantId` on invoke nodes (multi-tenant isolation)
- Config annotations displayed in Mermaid node labels (e.g. `flat`, `first successful`, `AtMostOncePerRetry`, `tenant tenant-abc-123`)
- New example files exercising all new features: `order_processor_with_retry.py`, `OrderProcessorFutures.java`, `order-workflow-config.ts`

### Changed

- Updated supported primitives table in README with full three-language parity status
- Mermaid renderer now appends config annotations below node labels using `<br>` separators

## [0.3.0] - 2026-05-15

### Added

- `withRetry` primitive support for TypeScript and Java parsers
  - TypeScript: detects `withRetry(context, "name", fn, config)` calls (SDK v2.0.0-alpha.1)
  - Java: detects both `ctx.withRetry(...)` and static `withRetry(ctx, "name", ...)` calls (SDK v1.1.0)
  - Rendered as subroutine shape with teal color (same as Child Context)

## [0.2.0] - 2026-04-23

### Changed

- Java SDK support upgraded from preview to GA following the [AWS Lambda Durable Execution SDK for Java general availability announcement](https://aws.amazon.com/about-aws/whats-new/2026/04/lambda-durable-execution-java-ga/)
- Java parser now extracts parallel/map branch names from `List.of()` and `Arrays.asList()` calls
- Updated Java example to showcase `parallel` primitive
- Removed Java SDK preview limitation from documentation

## [0.1.3] - 2026-03-25

### Added

- Direction toggle (TD/LR) in browser and VS Code extension, with state persisted across auto-refresh
- Source view panel with Mermaid and JSON tabs in browser and VS Code extension
- Fade-in transition on initial load to prevent layout blink

### Fixed

- Save PNG in VS Code extension (added `img-src data:` to Content Security Policy)
- PNG export resolution for landscape (LR) diagrams by using SVG viewBox dimensions
- Direction toggle re-render centering by resetting transform and deferring fit-to-view

### Changed

- PNG export now uses transparent background instead of solid color
- PNG export resolution increased from 2x to 4x

## [0.1.2] - 2026-03-25

### Added

- Save PNG button in browser and VS Code extension

### Fixed

- npm publish configuration

## [0.1.1] - 2026-03-25

### Added

- README files with Mermaid diagram for npm and VS Code Marketplace

## [0.1.0] - 2026-03-25

### Added

- TypeScript/JavaScript parser using ts-morph AST with function-reference following and registry key resolution
- Python parser (regex-based) with `@durable_execution` decorator detection
- Java parser (regex-based, preview) with `DurableHandler` class detection
- All durable execution primitives: step, invoke, parallel, map, wait, waitForCallback, createCallback, waitForCondition, runInChildContext
- Conditional branch detection with early-return handling
- Mermaid flowchart renderer with color-coded node types
- JSON output for custom tooling
- CLI with `--open` browser output, `--json`, `--direction`, and `--name` options
- VS Code extension with interactive side panel, click-to-navigate, scroll zoom, click-drag pan, auto-refresh on save
- Browser output with dark theme, zoom controls, and color legend
