# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
