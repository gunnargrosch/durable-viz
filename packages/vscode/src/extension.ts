import * as vscode from 'vscode'
import { parseFile, renderMermaid } from '@durable-viz/core'

let currentPanel: vscode.WebviewPanel | undefined
let currentFilePath: string | undefined

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand('durable-viz.open', () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('Durable Viz: No active editor')
      return
    }

    const filePath = editor.document.uri.fsPath
    openPanel(context, filePath)
  })

  context.subscriptions.push(command)

  // Auto-refresh on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (currentPanel && currentFilePath) {
        updatePanel(currentPanel, currentFilePath)
      }
    })
  )
}

function openPanel(context: vscode.ExtensionContext, filePath: string) {
  currentFilePath = filePath

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside)
    updatePanel(currentPanel, filePath)
    return
  }

  currentPanel = vscode.window.createWebviewPanel(
    'durableViz',
    'Durable Viz',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  )

  currentPanel.onDidDispose(() => {
    currentPanel = undefined
    currentFilePath = undefined
  })

  // Handle messages from webview (click-to-navigate)
  currentPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'goToLine' && currentFilePath) {
      const line = message.line - 1 // VS Code uses 0-based lines
      const uri = vscode.Uri.file(currentFilePath)
      const doc = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
      const range = new vscode.Range(line, 0, line, 0)
      editor.selection = new vscode.Selection(range.start, range.start)
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
    }
  })

  updatePanel(currentPanel, filePath)
}

function updatePanel(panel: vscode.WebviewPanel, filePath: string) {
  try {
    const graph = parseFile(filePath)
    const mermaid = renderMermaid(graph, { direction: 'TD' })
    panel.title = `Durable Viz: ${graph.name}`
    panel.webview.html = buildWebviewHtml(mermaid, graph.name)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    panel.webview.html = buildErrorHtml(message)
  }
}

function buildWebviewHtml(mermaid: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'unsafe-inline';">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, sans-serif);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      flex-shrink: 0;
      font-size: 12px;
    }
    .title { opacity: 0.7; }
    .title span { opacity: 1; font-weight: 600; }
    .controls {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .controls button {
      background: var(--vscode-button-secondaryBackground, #333);
      border: none;
      color: var(--vscode-button-secondaryForeground, #ccc);
      padding: 2px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .controls button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #444);
    }
    .controls span {
      font-size: 11px;
      opacity: 0.6;
      min-width: 36px;
      text-align: center;
    }
    .diagram-container {
      flex: 1;
      overflow: hidden;
      position: relative;
      cursor: grab;
    }
    .diagram-container.dragging { cursor: grabbing; }
    .diagram-wrapper {
      position: absolute;
      transform-origin: 0 0;
    }
    .mermaid svg {
      max-width: none !important;
      height: auto !important;
    }
    .mermaid .node { cursor: pointer; }
    .mermaid .node:hover { filter: brightness(1.2); }
    .mermaid .node .label { padding: 8px 12px; }
    .legend {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      padding: 6px 12px;
      font-size: 10px;
      opacity: 0.5;
      border-top: 1px solid var(--vscode-panel-border, #333);
      flex-shrink: 0;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <header>
    <div class="title">durable-viz: <span>${title}</span></div>
    <div class="controls">
      <button id="zoom-out">-</button>
      <span id="zoom-level">100%</span>
      <button id="zoom-in">+</button>
      <button id="zoom-fit">Fit</button>
    </div>
  </header>
  <div class="diagram-container" id="container">
    <div class="diagram-wrapper" id="wrapper">
      <pre class="mermaid">
${mermaid}
      </pre>
    </div>
  </div>
  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background:#5b8ab4"></div> Start / End</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#4a8c72"></div> Step</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#b8873a"></div> Invoke</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#7b6b9e"></div> Parallel / Map</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#b05a5a"></div> Wait / Callback</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#6b71a8"></div> Condition</div>
    <div class="legend-item"><div class="legend-swatch" style="background:#4a849e"></div> Child Context</div>
  </div>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

    const vscode = acquireVsCodeApi();

    // Mermaid click callback — called when a node with a source line is clicked
    window.onNodeClick = function(line) {
      vscode.postMessage({ type: 'goToLine', line: line });
    };

    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      securityLevel: 'loose',
      flowchart: { curve: 'basis', padding: 15, nodeSpacing: 30, rankSpacing: 40 },
      themeVariables: { nodePadding: 12 },
    });

    // --- Pan & Zoom ---
    const wrapper = document.getElementById('wrapper');
    const zoomLabel = document.getElementById('zoom-level');
    const container = document.getElementById('container');

    let scale = 1;
    let panX = 0;
    let panY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panStartX = 0;
    let panStartY = 0;

    function applyTransform() {
      wrapper.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
      zoomLabel.textContent = Math.round(scale * 100) + '%';
    }

    function setZoom(newScale, cx, cy) {
      newScale = Math.max(0.1, Math.min(5, newScale));
      if (cx !== undefined && cy !== undefined) {
        // Zoom towards cursor position
        panX = cx - (cx - panX) * (newScale / scale);
        panY = cy - (cy - panY) * (newScale / scale);
      }
      scale = newScale;
      applyTransform();
    }

    function fitToView() {
      const svg = wrapper.querySelector('svg');
      if (!svg) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const sw = svg.clientWidth || svg.getBoundingClientRect().width;
      const sh = svg.clientHeight || svg.getBoundingClientRect().height;
      if (!sw || !sh) return;
      const fitScale = Math.min(cw / sw, ch / sh) * 0.9;
      scale = fitScale;
      panX = (cw - sw * scale) / 2;
      panY = (ch - sh * scale) / 2;
      applyTransform();
    }

    // Scroll wheel zoom
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom(scale * delta, cx, cy);
    }, { passive: false });

    // Click-drag pan
    container.addEventListener('mousedown', (e) => {
      // Only pan on left-click, not on node clicks
      if (e.button !== 0) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panStartX = panX;
      panStartY = panY;
      container.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panX = panStartX + (e.clientX - dragStartX);
      panY = panStartY + (e.clientY - dragStartY);
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      container.classList.remove('dragging');
    });

    // Button controls
    document.getElementById('zoom-in').onclick = () => {
      const rect = container.getBoundingClientRect();
      setZoom(scale * 1.25, rect.width / 2, rect.height / 2);
    };
    document.getElementById('zoom-out').onclick = () => {
      const rect = container.getBoundingClientRect();
      setZoom(scale / 1.25, rect.width / 2, rect.height / 2);
    };
    document.getElementById('zoom-fit').onclick = fitToView;

    // Auto-fit after Mermaid renders
    setTimeout(fitToView, 500);
  </script>
</body>
</html>`
}

function buildErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: var(--vscode-font-family, sans-serif);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 2rem;
    }
    .error {
      text-align: center;
      max-width: 500px;
    }
    .error h2 {
      color: var(--vscode-errorForeground, #f48771);
      margin-bottom: 0.5rem;
      font-size: 14px;
    }
    .error p {
      opacity: 0.7;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="error">
    <h2>Could not parse durable function</h2>
    <p>${message}</p>
  </div>
</body>
</html>`
}

export function deactivate() {}
