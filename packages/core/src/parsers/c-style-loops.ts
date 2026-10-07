/**
 * Loop header parsing shared by the brace-based parsers (Java, C#).
 */

export interface CStyleLoopHead {
  keyword: 'for' | 'foreach' | 'while' | 'do'
  /** Text inside the parentheses, e.g. "int i = 0; i < 3; i++". Empty for `do`. */
  header: string
  /** Text after the header: "{" for same-line braces, "" when the brace is on the next line. */
  rest: string
}

/**
 * Parse a loop statement head such as `for (...) {`, `await foreach (...)`,
 * `while (...)`, `do {` or a labeled variant. Parentheses are balanced, so
 * headers that contain calls (`foreach (var x in GetItems())`) stay intact.
 */
export function parseCStyleLoopHead(line: string): CStyleLoopHead | undefined {
  const code = line.replace(/\s*\/\/.*$/, '').trim()

  const doMatch = code.match(/^(?:\w+:\s*)?do\s*(\{?)$/)
  if (doMatch) return { keyword: 'do', header: '', rest: doMatch[1] }

  const head = code.match(/^(?:\w+:\s*)?(?:await\s+)?(for|foreach|while)\s*\(/)
  if (!head) return undefined

  const openIdx = head[0].length - 1
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')') {
      depth--
      if (depth === 0) {
        return {
          keyword: head[1] as CStyleLoopHead['keyword'],
          header: code.slice(openIdx + 1, i).trim(),
          rest: code.slice(i + 1).trim(),
        }
      }
    }
  }
  return undefined
}

/** Count iterations for `for (int i = 0; i < 3; i++)` style headers with literal bounds. */
export function cStyleLoopIterations(head: CStyleLoopHead): number | undefined {
  if (head.keyword !== 'for') return undefined
  const parts = head.header.split(';').map((part) => part.trim())
  if (parts.length !== 3) return undefined

  const init = parts[0].match(/^(?:(?:int|long|short|byte|uint|ulong|var)\s+)?(\w+)\s*=\s*(\d+)$/)
  const condition = parts[1].match(/^(\w+)\s*(<=|<)\s*(\d+)$/)
  const increment = parts[2].match(/^(?:(\w+)\+\+|\+\+(\w+)|(\w+)\s*\+=\s*1)$/)
  if (!init || !condition || !increment) return undefined

  const variable = init[1]
  if (condition[1] !== variable || ![increment[1], increment[2], increment[3]].includes(variable)) return undefined
  const count = Number(condition[3]) - Number(init[2]) + (condition[2] === '<=' ? 1 : 0)
  return count > 0 ? count : undefined
}

/**
 * For `do { ... } while (cond);`, read the condition from the text that
 * follows the closing brace. `closeIdx` is the index of that brace in `body`.
 */
export function doWhileCondition(body: string, closeIdx: number): string {
  const lineEnd = body.indexOf('\n', closeIdx)
  const tail = body.slice(closeIdx + 1, lineEnd === -1 ? undefined : lineEnd)
  return tail.match(/^\s*while\s*\((.*)\)\s*;/)?.[1].trim() ?? ''
}
