/**
 * Source-line helpers shared by the regex-based parsers.
 */

/**
 * Return the 1-based line number of the last non-empty line in a handler body.
 *
 * Brace-delimited bodies exclude the closing brace, and Python bodies can end
 * with the blank lines before the next dedented block. Skipping the trailing
 * empty lines points an End node at the handler's last statement instead of
 * the closing delimiter or the line after the handler.
 */
export function lastContentLine(body: string, baseLineOffset: number): number {
  const lines = body.split('\n')
  let index = lines.length - 1
  while (index > 0 && lines[index].trim() === '') index--
  return baseLineOffset + index
}
