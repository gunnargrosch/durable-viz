# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
