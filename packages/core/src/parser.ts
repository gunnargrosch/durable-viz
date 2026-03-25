/**
 * Parser interface and dispatch logic.
 *
 * Each language has its own parser implementation in parsers/.
 * This module provides the common interface and a parseFile()
 * entrypoint that selects the right parser by file extension.
 */

import type { WorkflowGraph } from './graph.js'

export interface ParseOptions {
  /** Override the workflow name (defaults to filename). */
  name?: string
}

export interface Parser {
  /** File extensions this parser handles (e.g. ['.ts', '.js']). */
  extensions: string[]
  /** Parse a file and return its workflow graph. */
  parseFile(filePath: string, options?: ParseOptions): WorkflowGraph
}

// Registry of available parsers — add new languages here.
import { TypeScriptParser } from './parsers/typescript.js'
import { PythonParser } from './parsers/python.js'
import { JavaParser } from './parsers/java.js'

const parsers: Parser[] = [
  new TypeScriptParser(),
  new PythonParser(),
  new JavaParser(),
]

function getParser(filePath: string): Parser {
  const ext = filePath.slice(filePath.lastIndexOf('.'))
  const parser = parsers.find((p) => p.extensions.includes(ext))
  if (!parser) {
    const supported = parsers.flatMap((p) => p.extensions).join(', ')
    throw new Error(`No parser for ${ext} files. Supported: ${supported}`)
  }
  return parser
}

/**
 * Parse a file containing a durable function handler
 * and extract its workflow graph.
 *
 * Automatically selects the parser based on file extension.
 */
export function parseFile(filePath: string, options?: ParseOptions): WorkflowGraph {
  const parser = getParser(filePath)
  return parser.parseFile(filePath, options)
}
