/**
 * Shared look for the card-style diagram: icons, accent colors, CSS and legend.
 *
 * The host page (VS Code webview or CLI HTML) defines these CSS variables on
 * `:root` or `body`, so the diagram follows the surrounding theme:
 *   --dv-bg, --dv-card, --dv-border, --dv-fg, --dv-muted, --dv-edge
 */

import type { NodeKind } from '../graph.js'

export type CardGroup =
  | 'terminal'
  | 'step'
  | 'invoke'
  | 'fanout'
  | 'wait'
  | 'callback'
  | 'child'
  | 'condition'
  | 'loop'

export const CARD_GROUP_ACCENT: Record<CardGroup, string> = {
  terminal: '#e8c547',
  step: '#3fa37f',
  invoke: '#d39a3a',
  fanout: '#9283c4',
  wait: '#d46a6a',
  callback: '#d46a8f',
  child: '#4a9bbd',
  condition: '#7c84d4',
  loop: '#9aab45',
}

export function cardGroupForKind(kind: NodeKind): CardGroup {
  switch (kind) {
    case 'start':
    case 'end':
      return 'terminal'
    case 'step':
      return 'step'
    case 'invoke':
      return 'invoke'
    case 'parallel':
    case 'map':
    case 'promiseAll':
    case 'promiseAny':
    case 'promiseRace':
    case 'promiseAllSettled':
      return 'fanout'
    case 'wait':
    case 'waitForCondition':
      return 'wait'
    case 'waitForCallback':
    case 'createCallback':
      return 'callback'
    case 'runInChildContext':
    case 'withRetry':
      return 'child'
    case 'condition':
      return 'condition'
    case 'loop':
      return 'loop'
  }
}

export const CARD_KIND_LABEL: Record<NodeKind, string> = {
  start: 'Start',
  end: 'End',
  step: 'Step',
  invoke: 'Invoke',
  parallel: 'Parallel',
  map: 'Map',
  wait: 'Wait',
  waitForCallback: 'Wait for callback',
  createCallback: 'Create callback',
  waitForCondition: 'Wait for condition',
  runInChildContext: 'Child context',
  withRetry: 'With retry',
  promiseAll: 'Promise.all',
  promiseAny: 'Promise.any',
  promiseRace: 'Promise.race',
  promiseAllSettled: 'Promise.allSettled',
  condition: 'Condition',
  loop: 'Loop',
}

/** Inner SVG markup (24x24 viewBox, stroke only) per icon. */
const ICON_PATHS = {
  step: "<path d='M9 8l-4 4 4 4M15 8l4 4-4 4'/>",
  invoke: "<path d='M3 12h10M9 8l4 4-4 4'/><rect x='16' y='5' width='5' height='14' rx='1'/>",
  fanout: "<path d='M12 4v6M12 10L6 16M12 10l6 6M6 16v4M18 16v4'/>",
  wait: "<circle cx='12' cy='12' r='8'/><path d='M12 8v4l3 2'/>",
  callback: "<path d='M6 16v-5a6 6 0 0112 0v5l2 2H4z'/><path d='M10 21h4'/>",
  child: "<rect x='3' y='3' width='18' height='18' rx='2'/><rect x='8' y='8' width='8' height='8' rx='1'/>",
  retry: "<path d='M20 12a8 8 0 10-3 6.2'/><path d='M20 5v5h-5'/>",
  condition: "<path d='M12 3l9 9-9 9-9-9z'/>",
  loop: "<path d='M17 4l3 3-3 3'/><path d='M4 11V9a2 2 0 012-2h16'/><path d='M7 20l-3-3 3-3'/><path d='M20 13v2a2 2 0 01-2 2H2'/>",
} as const

type IconName = keyof typeof ICON_PATHS

export function cardIconForKind(kind: NodeKind): IconName | undefined {
  switch (kind) {
    case 'start':
    case 'end':
      return undefined
    case 'withRetry':
      return 'retry'
    default:
      return cardGroupForKind(kind) as IconName
  }
}

function iconDataUri(name: IconName): string {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' " +
    "stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'>" +
    ICON_PATHS[name] +
    '</svg>'
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** CSS for the card diagram. Pair with the CSS variables listed at the top of this file. */
export function cardDiagramCss(): string {
  const groups = (Object.keys(CARD_GROUP_ACCENT) as CardGroup[])
    .map((group) => `.dv-${group} { --dv-accent: ${CARD_GROUP_ACCENT[group]}; }`)
    .join('\n')
  const icons = (Object.keys(ICON_PATHS) as IconName[])
    .map((name) => `.dv-i-${name} { -webkit-mask-image: ${iconDataUri(name)}; mask-image: ${iconDataUri(name)}; }`)
    .join('\n')
  return `
${groups}
.dv-icon {
  display: inline-block;
  flex: none;
  width: 30px;
  height: 30px;
  background-color: var(--dv-accent, var(--dv-muted));
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
}
${icons}
.dv-card { display: flex; align-items: center; gap: 12px; text-align: left; white-space: nowrap; line-height: 1.25; }
.dv-text { display: flex; flex-direction: column; }
.dv-kind { font-size: 11px; color: var(--dv-muted); }
.dv-name { font-size: 14px; color: var(--dv-fg); }
.dv-meta { font-size: 10px; color: var(--dv-muted); margin-top: 2px; }
.mermaid .dv-terminal-label, .mermaid .node.dv-terminal span { font-size: 14px; color: #2b2610 !important; font-weight: 500; }
.mermaid .node.dv-terminal circle, .mermaid .node.dv-terminal ellipse {
  fill: var(--dv-accent) !important; stroke: none !important;
}
.mermaid .node:not(.dv-terminal) rect, .mermaid .node:not(.dv-terminal) polygon {
  fill: var(--dv-card) !important;
  stroke: var(--dv-border) !important;
  stroke-width: 1px !important;
  rx: 6px; ry: 6px;
}
.mermaid .node:not(.dv-terminal):hover rect { stroke: var(--dv-accent, var(--dv-muted)) !important; }
.mermaid .cluster rect {
  fill: transparent !important;
  stroke: var(--dv-border) !important;
  stroke-width: 1px !important;
  stroke-dasharray: none !important;
  rx: 10px; ry: 10px;
}
.mermaid .edgePaths path, .mermaid path.flowchart-link { stroke: var(--dv-edge) !important; stroke-width: 1.2px !important; }
.mermaid .marker, .mermaid .arrowheadPath, .mermaid marker path { fill: var(--dv-edge) !important; stroke: var(--dv-edge) !important; }
.mermaid .edgeLabel, .mermaid .edgeLabel p, .mermaid .edgeLabel span { color: var(--dv-fg) !important; font-size: 11px; }
.mermaid .edgeLabel rect { fill: var(--dv-card) !important; }
.mermaid .labelBkg, .mermaid .edgeLabel, .mermaid span.edgeLabel { background: transparent !important; background-color: transparent !important; border: none !important; opacity: 1 !important; }
.mermaid .edgeLabel p { background: var(--dv-card) !important; background-color: var(--dv-card) !important; border: 1px solid var(--dv-border); border-radius: 4px; padding: 1px 6px; margin: 0; }
.mermaid g.edgeLabel:not(:has(p)), .mermaid .edgeLabel p:empty { display: none !important; }
.mermaid .node .label { padding: 0 !important; }
`
}

const LEGEND_ENTRIES: { group: CardGroup; icon: IconName | undefined; label: string }[] = [
  { group: 'terminal', icon: undefined, label: 'Start / End' },
  { group: 'step', icon: 'step', label: 'Step' },
  { group: 'invoke', icon: 'invoke', label: 'Invoke' },
  { group: 'fanout', icon: 'fanout', label: 'Parallel / Map' },
  { group: 'wait', icon: 'wait', label: 'Wait' },
  { group: 'callback', icon: 'callback', label: 'Callback' },
  { group: 'condition', icon: 'condition', label: 'Condition' },
  { group: 'loop', icon: 'loop', label: 'Loop' },
  { group: 'child', icon: 'child', label: 'Child Context' },
]

/** Legend items, one per accent group, drawn with the same icons as the nodes. */
export function cardLegendHtml(): string {
  return LEGEND_ENTRIES.map(({ group, icon, label }) => {
    const swatch = icon
      ? `<span class="dv-icon dv-i-${icon} dv-${group}" style="width:14px;height:14px"></span>`
      : `<span class="dv-${group}" style="width:12px;height:12px;border-radius:50%;background:var(--dv-accent);display:inline-block"></span>`
    return `<div class="legend-item">${swatch} ${label}</div>`
  }).join('\n    ')
}
