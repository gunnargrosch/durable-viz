# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
