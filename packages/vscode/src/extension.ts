import * as vscode from 'vscode'
import { parseFile, renderMermaid } from '@durable-viz/core'
import { generateCode } from '@durable-viz/core'

let currentPanel: vscode.WebviewPanel | undefined
let currentFilePath: string | undefined
let currentDirection: 'TD' | 'LR' = 'TD'

export function activate(context: vscode.ExtensionContext) {
  const openCommand = vscode.commands.registerCommand('durable-viz.open', () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('Durable Viz: No active editor')
      return
    }

    const filePath = editor.document.uri.fsPath
    openPanel(context, filePath)
  })

  const buildCommand = vscode.commands.registerCommand('durable-viz.build', () => {
    openBuildPanel()
  })

  context.subscriptions.push(openCommand, buildCommand)

  // Auto-refresh on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
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

  // Handle messages from webview
  currentPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'goToLine' && currentFilePath) {
      const line = message.line - 1 // VS Code uses 0-based lines
      const uri = vscode.Uri.file(currentFilePath)
      const doc = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
      const range = new vscode.Range(line, 0, line, 0)
      editor.selection = new vscode.Selection(range.start, range.start)
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
    } else if (message.type === 'savePng') {
      const name = currentFilePath ? currentFilePath.split('/').pop()?.replace(/\.[^.]+$/, '') : 'workflow'
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${name}-durable-viz.png`),
        filters: { 'PNG Image': ['png'] },
      })
      if (uri) {
        const base64 = message.data.replace(/^data:image\/png;base64,/, '')
        await vscode.workspace.fs.writeFile(uri, Buffer.from(base64, 'base64'))
        vscode.window.showInformationMessage(`Saved: ${uri.fsPath}`)
      }
    } else if (message.type === 'directionChanged') {
      currentDirection = message.direction
    }
  })

  updatePanel(currentPanel, filePath)
}

function updatePanel(panel: vscode.WebviewPanel, filePath: string) {
  try {
    const graph = parseFile(filePath)
    const mermaid = renderMermaid(graph, { direction: currentDirection })
    panel.title = `Durable Viz: ${graph.name}`
    panel.webview.html = buildWebviewHtml(mermaid, graph.name, JSON.stringify(graph, null, 2), currentDirection)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    panel.webview.html = buildErrorHtml(message)
  }
}

function buildWebviewHtml(mermaid: string, title: string, graphJson: string, direction: 'TD' | 'LR'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">
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
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .diagram-wrapper.ready { opacity: 1; }
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
    .source-panel {
      display: none;
      position: absolute;
      inset: 0;
      background: var(--vscode-editor-background, #1e1e1e);
      z-index: 10;
      flex-direction: column;
    }
    .source-panel.visible { display: flex; }
    .source-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      flex-shrink: 0;
    }
    .source-tabs button {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground, #888);
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      border-bottom: 2px solid transparent;
    }
    .source-tabs button.active {
      color: var(--vscode-editor-foreground, #d4d4d4);
      border-bottom-color: var(--vscode-editor-foreground, #d4d4d4);
    }
    .source-content {
      flex: 1;
      overflow: auto;
      padding: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre;
      color: var(--vscode-editor-foreground, #d4d4d4);
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
      <button id="toggle-direction">${direction === 'TD' ? 'LR' : 'TD'}</button>
      <button id="download-png">Save PNG</button>
      <button id="toggle-source">Source</button>
    </div>
  </header>
  <div class="diagram-container" id="container">
    <div class="diagram-wrapper" id="wrapper">
      <pre class="mermaid">
${mermaid}
      </pre>
    </div>
    <div class="source-panel" id="source-panel">
      <div class="source-tabs">
        <button class="active" data-tab="mermaid">Mermaid</button>
        <button data-tab="json">JSON</button>
      </div>
      <div class="source-content" id="source-content"></div>
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
  <script type="application/json" id="graph-json">${graphJson}</script>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

    const vscode = acquireVsCodeApi();

    // Mermaid click callback - called when a node with a source line is clicked
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

    let mermaidRaw = document.querySelector('.mermaid').textContent.trim();
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

    document.getElementById('toggle-direction').onclick = async () => {
      const btn = document.getElementById('toggle-direction');
      const mermaidEl = wrapper.querySelector('.mermaid');
      const isLR = mermaidRaw.startsWith('graph LR');
      mermaidRaw = isLR ? mermaidRaw.replace(/^graph LR/, 'graph TD') : mermaidRaw.replace(/^graph TD/, 'graph LR');
      btn.textContent = isLR ? 'LR' : 'TD';
      vscode.postMessage({ type: 'directionChanged', direction: isLR ? 'TD' : 'LR' });
      mermaidEl.removeAttribute('data-processed');
      mermaidEl.innerHTML = mermaidRaw;
      wrapper.classList.remove('ready');
      scale = 1; panX = 0; panY = 0; applyTransform();
      await mermaid.run({ nodes: [mermaidEl] });
      requestAnimationFrame(() => { fitToView(); wrapper.classList.add('ready'); });
    };

    document.getElementById('download-png').onclick = () => {
      const svg = wrapper.querySelector('svg');
      if (!svg) return;
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const s = 4;
      const bb = svg.viewBox.baseVal;
      const sw = bb.width || svg.clientWidth;
      const sh = bb.height || svg.clientHeight;
      canvas.width = sw * s;
      canvas.height = sh * s;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        vscode.postMessage({ type: 'savePng', data: dataUrl });
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
    };

    function getMermaidSource() { return mermaidRaw; }
    const jsonSource = document.getElementById('graph-json').textContent;
    const sourcePanel = document.getElementById('source-panel');
    const sourceContent = document.getElementById('source-content');
    let activeTab = 'mermaid';

    document.querySelectorAll('.source-tabs button').forEach(btn => {
      btn.onclick = () => {
        document.querySelector('.source-tabs .active').classList.remove('active');
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        sourceContent.textContent = activeTab === 'mermaid' ? getMermaidSource() : jsonSource;
      };
    });

    const toggleBtn = document.getElementById('toggle-source');
    toggleBtn.onclick = () => {
      const visible = sourcePanel.classList.toggle('visible');
      toggleBtn.textContent = visible ? 'Diagram' : 'Source';
      if (visible) sourceContent.textContent = activeTab === 'mermaid' ? getMermaidSource() : jsonSource;
    };

    setTimeout(() => {
      fitToView();
      wrapper.classList.add('ready');
    }, 500);
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

// ---------------------------------------------------------------------------
// Build mode (visual canvas → code generation)
// ---------------------------------------------------------------------------

let buildPanel: vscode.WebviewPanel | undefined

function openBuildPanel() {
  if (buildPanel) {
    buildPanel.reveal(vscode.ViewColumn.Beside)
    return
  }

  buildPanel = vscode.window.createWebviewPanel(
    'durableVizBuild',
    'Durable Viz: Build',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  )

  buildPanel.onDidDispose(() => {
    buildPanel = undefined
  })

  buildPanel.webview.html = buildBuildHtml()

  buildPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'debugLog') {
      console.log('[build]', message.msg)
      return
    }
    if (message.type === 'generateCode') {
      const { graphJson, language } = message
      try {
        const graph = JSON.parse(graphJson)
        const code = generateCode(graph, { language })
        const ext = language === 'python' ? '.py' : language === 'java' ? '.java' : language === 'csharp' ? '.cs' : language === 'rust' ? '.rs' : language === 'go' ? '.go' : '.ts'
        const lang = language === 'python' ? 'python' : language === 'java' ? 'java' : language === 'csharp' ? 'csharp' : language === 'rust' ? 'rust' : language === 'go' ? 'go' : 'typescript'
        const doc = await vscode.workspace.openTextDocument({
          content: code,
          language: lang,
        })
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One)
        vscode.window.showInformationMessage(`Generated ${graph.name || 'workflow'}${ext}`)
      } catch (err) {
        vscode.window.showErrorMessage(`Code generation failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (message.type === 'saveGraph') {
      try {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('workflow.json'),
          filters: { 'Workflow Graph': ['json'] },
        })
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(message.data, 'utf-8'))
          vscode.window.showInformationMessage('Graph saved.')
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (message.type === 'loadGraph') {
      try {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'Workflow Graph': ['json'] },
          canSelectMany: false,
        })
        if (uris && uris[0]) {
          const data = await vscode.workspace.fs.readFile(uris[0])
          buildPanel.webview.postMessage({ type: 'loadGraphData', data: Buffer.from(data).toString('utf-8') })
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Load failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (message.type === 'exportPNG') {
      try {
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('workflow.png'),
          filters: { 'PNG Image': ['png'] },
        })
        if (uri) {
          const base64 = message.data.replace(/^data:image\/png;base64,/, '')
          await vscode.workspace.fs.writeFile(uri, Buffer.from(base64, 'base64'))
          vscode.window.showInformationMessage('PNG exported.')
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  })
}

function buildBuildHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src https://cdn.jsdelivr.net https://unpkg.com 'unsafe-inline'; style-src 'unsafe-inline';">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, sans-serif);
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      display: flex;
      height: 100vh;
      overflow: hidden;
    }
    .palette {
      width: 180px;
      border-right: 1px solid var(--vscode-panel-border, #333);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .palette-header {
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      opacity: 0.6;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    .palette-items {
      flex: 1;
      overflow-y: auto;
      padding: 6px;
    }
    .palette-item {
      padding: 6px 8px;
      margin-bottom: 3px;
      border-radius: 3px;
      cursor: grab;
      font-size: 11px;
      user-select: none;
      border: 1px solid transparent;
    }
    .palette-item:hover { border-color: var(--vscode-focusBorder, #007acc); }
    .palette-item .swatch {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      margin-right: 6px;
    }
    .palette-item.step .swatch { background: #4a8c72; }
    .palette-item.invoke .swatch { background: #b8873a; }
    .palette-item.parallel .swatch { background: #7b6b9e; }
    .palette-item.condition .swatch { background: #6b71a8; }
    .palette-item.wait .swatch { background: #b05a5a; }
    .toolbar {
      padding: 6px 0;
      border-top: 1px solid var(--vscode-panel-border, #333);
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
    }
    .toolbar select, .toolbar button {
      background: var(--vscode-button-secondaryBackground, #333);
      border: none;
      color: var(--vscode-button-secondaryForeground, #ccc);
      padding: 4px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      width: 100%;
      text-align: center;
    }
    .toolbar button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #444);
    }
    .toolbar button.primary {
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #fff);
    }
    .toolbar button.primary:hover {
      background: var(--vscode-button-hoverBackground, #1a8ad4);
    }
    .toolbar button.small {
      padding: 2px 6px;
      font-size: 10px;
    }
    .toolbar .toolbar-row {
      display: flex;
      gap: 3px;
    }
    .canvas-area {
      flex: 1;
      position: relative;
      overflow: hidden;
    }
    #cy {
      width: 100%;
      height: 100%;
      background-image:
        radial-gradient(circle, var(--vscode-panel-border, #444) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    .help {
      padding: 6px 8px;
      font-size: 10px;
      opacity: 0.4;
      border-top: 1px solid var(--vscode-panel-border, #333);
    }
  </style>
</head>
<body>
  <div class="palette">
    <div class="palette-header">
      <select id="palette-language" style="width:100%; background:var(--vscode-dropdown-background, #3c3c3c); border:1px solid var(--vscode-dropdown-border, #555); color:var(--vscode-dropdown-foreground, #ccc); padding:2px 4px; font-size:11px; border-radius:3px;">
        <option value="typescript">TypeScript</option>
        <option value="python">Python</option>
        <option value="java">Java</option>
        <option value="csharp">C# (.NET)</option>
        <option value="rust">Rust</option>
        <option value="go">Go</option>
      </select>
    </div>
    <div class="palette-items">
      <div class="palette-item step" draggable="true" data-kind="step" data-label="step" data-langs="typescript python java csharp rust go">🟢 Step</div>
      <div class="palette-item invoke" draggable="true" data-kind="invoke" data-label="invoke" data-langs="typescript python java csharp rust go">🟠 Invoke</div>
      <div class="palette-item parallel" draggable="true" data-kind="parallel" data-label="parallel" data-langs="typescript python java csharp rust go">🟣 Parallel</div>
      <div class="palette-item" draggable="true" data-kind="map" data-label="map" data-langs="typescript python java csharp rust go">🟣 Map</div>
      <div class="palette-item wait" draggable="true" data-kind="wait" data-label="wait" data-langs="typescript python java csharp rust go">🔴 Wait</div>
      <div class="palette-item wait" draggable="true" data-kind="waitForCallback" data-label="callback" data-langs="typescript python java csharp rust go">🔴 Callback</div>
      <div class="palette-item wait" draggable="true" data-kind="createCallback" data-label="create-callback" data-langs="typescript python java csharp rust go">🔴 Create Callback</div>
      <div class="palette-item wait" draggable="true" data-kind="waitForCondition" data-label="poll" data-langs="typescript python java csharp rust go">🔴 Poll</div>
      <div class="palette-item condition" draggable="true" data-kind="condition" data-label="condition" data-langs="typescript python java csharp rust go">🔵 Condition</div>
      <div class="palette-item" draggable="true" data-kind="withRetry" data-label="retry" data-langs="typescript python java rust go">🩵 With Retry</div>
      <div class="palette-item" draggable="true" data-kind="runInChildContext" data-label="child" data-langs="typescript python java csharp rust go">🩵 Child Context</div>
      <div class="palette-item" draggable="true" data-kind="promiseAll" data-label="join-all" data-langs="typescript rust go">🟣 Join All</div>
      <div class="palette-item" draggable="true" data-kind="promiseAny" data-label="select-ok" data-langs="typescript rust go">🟣 Any</div>
      <div class="palette-item" draggable="true" data-kind="promiseRace" data-label="race" data-langs="typescript rust go">🟣 Race</div>
      <div class="palette-item" draggable="true" data-kind="promiseAllSettled" data-label="all-settled" data-langs="typescript rust go">🟣 All Settled</div>
    </div>
    <div class="help">
      Drag primitives onto the canvas.<br>
      Click nodes to connect them.<br>
      Drop nodes on <b>Parallel/Map</b> to create branches.<br>
      <b>Condition</b> edges are auto-labeled <b>if</b>/<b>else</b> when connecting.<br>
      Double-click to rename, <b>Del</b> to delete selected, <b>Esc</b> to deselect.
    </div>
    <div class="toolbar">
      <button id="generate-btn" class="primary">Generate Code</button>
      <div class="toolbar-row">
        <button id="preview-btn" class="small">Preview</button>
        <button id="layout-btn" class="small">Arrange</button>
        <button id="fit-btn" class="small">Fit</button>
        <button id="export-btn" class="small">PNG</button>
      </div>
      <div class="toolbar-row">
        <button id="save-btn" class="small">Save</button>
        <button id="load-btn" class="small">Load</button>
        <button id="clear-btn" class="small">Clear</button>
      </div>
    </div>
  </div>
    <div class="canvas-area" id="canvas-area">
    <div id="cy"></div>
  </div>
  <div id="rename-input" style="display:none; position:absolute; z-index:100;">
    <input type="text" id="rename-field" style="padding:4px 8px; border:2px solid #007acc; background:#1e1e1e; color:#d4d4d4; font-size:12px; border-radius:3px;" />
  </div>
  <div id="preview-panel" style="display:none; position:absolute; inset:0; z-index:50; background:var(--vscode-editor-background, #1e1e1e); flex-direction:column;">
    <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 12px; border-bottom:1px solid var(--vscode-panel-border, #333); flex-shrink:0;">
      <span style="font-size:12px; font-weight:600;">Preview</span>
      <div style="display:flex; gap:4px;">
        <button id="preview-mermaid-tab" style="background:var(--vscode-button-background); border:none; color:var(--vscode-button-foreground); padding:2px 10px; border-radius:3px; cursor:pointer; font-size:11px;">Mermaid</button>
        <button id="preview-close" style="background:var(--vscode-button-secondaryBackground,#333); border:none; color:var(--vscode-button-secondaryForeground,#ccc); padding:2px 10px; border-radius:3px; cursor:pointer; font-size:11px;">Close</button>
      </div>
    </div>
    <div style="flex:1; overflow:auto; padding:12px;">
      <pre id="preview-content" style="white-space:pre-wrap; font-family:monospace; font-size:11px; color:var(--vscode-editor-foreground,#d4d4d4);"></pre>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30/dist/cytoscape.min.js"></script>
  <script>
    const vscode = acquireVsCodeApi();

    // --- Cytoscape setup ---
    const cy = cytoscape({
      container: document.getElementById('cy'),
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: true,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#4a8c72',
            'label': 'data(label)',
            'color': '#e0efe8',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '12px',
            'width': 70,
            'height': 36,
            'shape': 'round-rectangle',
            'text-wrap': 'ellipsis',
            'text-max-width': '80px',
            'border-width': 0,
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 2,
            'border-color': '#007acc',
            'border-style': 'solid',
            'overlay-opacity': 0.1,
            'overlay-color': '#007acc',
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#007acc',
            'target-arrow-color': '#007acc',
            'width': 3,
          }
        },
        {
          selector: 'node[kind="invoke"]',
          style: { 'background-color': '#b8873a', 'color': '#f5edd8', 'shape': 'rhomboid' }
        },
        {
          selector: 'node[kind="parallel"], node[kind="map"]',
          style: {
            'background-color': '#7b6b9e',
            'color': '#e8e3f0',
            'shape': 'round-rectangle',
            'width': 240,
            'height': 100,
            'border-width': 2,
            'border-style': 'dashed',
            'border-color': '#655883',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-size': '11px',
            'text-margin-y': -8,
          }
        },
        {
          selector: 'node[kind="promiseAll"], node[kind="promiseAny"], node[kind="promiseRace"], node[kind="promiseAllSettled"]',
          style: { 'background-color': '#7b6b9e', 'color': '#e8e3f0', 'shape': 'hexagon' }
        },
        {
          selector: 'node[kind="wait"], node[kind="waitForCallback"], node[kind="createCallback"], node[kind="waitForCondition"]',
          style: { 'background-color': '#b05a5a', 'color': '#f2e0e0', 'shape': 'ellipse' }
        },
        {
          selector: 'node[kind="condition"]',
          style: { 'background-color': '#6b71a8', 'color': '#e3e4f0', 'shape': 'diamond' }
        },
        {
          selector: 'node[kind="runInChildContext"], node[kind="withRetry"]',
          style: { 'background-color': '#4a849e', 'color': '#deedf3', 'shape': 'round-rectangle' }
        },
        {
          selector: 'node.drag-ghost',
          style: {
            'background-color': '#007acc',
            'border-color': '#007acc',
            'border-width': 1,
            'border-style': 'dashed',
            'opacity': 0.4,
            'width': 70,
            'height': 36,
          }
        },
        {
          selector: 'node.connecting',
          style: {
            'border-width': 2,
            'border-color': '#ff9944',
            'border-style': 'solid',
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#555',
            'target-arrow-color': '#555',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '10px',
            'color': '#888',
          }
        }
      ],
    });

    // --- Grid snap ---
    const GRID = 20;
    function snapToGrid(v) { return Math.round(v / GRID) * GRID; }
    function modelFromRendered(rx, ry) {
      var z = cy.zoom(), p = cy.pan();
      return {
        x: snapToGrid((rx - p.x) / z),
        y: snapToGrid((ry - p.y) / z),
      };
    }
    cy.on('dragfree', 'node', function (evt) {
      var n = evt.target;
      n.position({
        x: snapToGrid(n.position().x),
        y: snapToGrid(n.position().y),
      });
      if ((n.data('kind') === 'parallel' || n.data('kind') === 'map') && dragChildOffsets.length) {
        dragChildOffsets.forEach(c => {
          c.node.position({ x: n.position().x + c.ox, y: n.position().y + c.oy });
        });
      }
    });

    let dragParent = null;
    let dragChildOffsets = [];
    cy.on('grab', 'node[kind="parallel"], node[kind="map"]', function (evt) {
      const parent = evt.target;
      dragParent = parent;
      dragChildOffsets = cy.nodes().filter(n => n.data('_parent') === parent.id())
        .map(n => ({ node: n, ox: n.position().x - parent.position().x, oy: n.position().y - parent.position().y }));
    });
    cy.on('drag', 'node[kind="parallel"], node[kind="map"]', function (evt) {
      if (!dragParent) return;
      dragChildOffsets.forEach(c => {
        c.node.position({ x: dragParent.position().x + c.ox, y: dragParent.position().y + c.oy });
      });
    });
    cy.on('free', 'node', function (evt) {
      if (evt.target === dragParent) {
        dragParent = null;
        dragChildOffsets = [];
      }
    });

    function fitWithMaxZoom(maxZoom) {
      maxZoom = maxZoom || 1.5;
      var els = cy.elements();
      if (els.length === 0) return;
      cy.fit(els, 30);
      if (cy.zoom() > maxZoom) {
        cy.zoom(maxZoom);
        cy.center(els);
      }
    }

    // --- Drag from palette ---
    let nodeCounter = 0;

    document.querySelectorAll('.palette-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
          kind: item.dataset.kind,
          label: item.dataset.label,
        }));
      });
    });

    // --- Language selector filters primitives ---
    const paletteLang = document.getElementById('palette-language');
    paletteLang.addEventListener('change', () => {
      const lang = paletteLang.value;
      document.querySelectorAll('.palette-item').forEach(item => {
        const langs = (item.dataset.langs || '').split(' ');
        item.style.display = langs.includes(lang) ? '' : 'none';
      });
    });

    const canvasArea = document.getElementById('canvas-area');
    let dragCount = 0;
    let dragGhost = null;

    function setDragOver(active) {
      if (active) {
        cy.nodes('[kind="parallel"], [kind="map"]').style('border-color', '#a08cc4');
      } else {
        cy.nodes('[kind="parallel"], [kind="map"]').style('border-color', '#655883');
      }
    }

    canvasArea.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCount++;
      setDragOver(true);
    });
    canvasArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragCount === 0) { dragCount++; setDragOver(true); }

      const rect = canvasArea.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      const pos = modelFromRendered(rx, ry);
      if (!dragGhost) {
        dragGhost = cy.add({
          group: 'nodes',
          data: { id: '__drag_ghost__', label: '' },
          position: { x: pos.x, y: pos.y },
          classes: 'drag-ghost',
        });
      } else {
        dragGhost.position({ x: pos.x, y: pos.y });
      }
    });
    canvasArea.addEventListener('dragleave', (e) => {
      dragCount--;
      if (dragCount <= 0) { dragCount = 0; setDragOver(false); }
      if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    });
    canvasArea.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCount = 0;
      setDragOver(false);
      if (dragGhost) { dragGhost.remove(); dragGhost = null; }

      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      const rect = canvasArea.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      const pos = modelFromRendered(rx, ry);

      // Hit test in rendered space (renderedBoundingBox is container-relative)
      const hitNode = cy.nodes('[kind="parallel"], [kind="map"]').filter(n => {
        const bb = n.renderedBoundingBox({ includeNodes: true, includeOverlays: false, includeEdges: false });
        return bb.x1 <= rx && rx <= bb.x2 && bb.y1 <= ry && ry <= bb.y2;
      }).first();

      if (hitNode.nonempty()) {
        addNode(data.kind, data.label, pos.x, pos.y, hitNode.id());
      } else {
        addNode(data.kind, data.label, pos.x, pos.y);
      }
    });

    function addNode(kind, label, x, y, parentId) {
      pushUndo();
      nodeCounter++;
      const id = kind + '_' + nodeCounter;
      let node;
      if (parentId) {
        const p = cy.getElementById(parentId);
        const pcx = p.position().x;
        const pcy = p.position().y;
        const existing = cy.nodes().filter(n => n.data('_parent') === parentId);
        const sorted = existing.sort((a, b) => a.position().x - b.position().x);
        const total = sorted.length + 1;
        const childW = 70, gap = 20;
        const span = total * childW + (total - 1) * gap;
        const startX = pcx - span / 2 + childW / 2;
        for (let i = 0; i < sorted.length; i++) {
          sorted[i].position({ x: startX + i * (childW + gap), y: pcy + 12 });
        }
        const px = startX + sorted.length * (childW + gap);
        const py = pcy + 12;
        node = cy.add({
          group: 'nodes',
          data: { id, kind, label, _parent: parentId },
          position: { x: px, y: py },
        });
      } else {
        node = cy.add({
          group: 'nodes',
          data: { id, kind, label },
          position: { x, y },
        });
      }

      // Auto-show rename input so user can name the node immediately
      renameNode = node;
      labelEdge = null;
      renameField.value = label;
      requestAnimationFrame(() => {
        const bb = node.renderedBoundingBox({ includeNodes: false });
        const cyContainer = document.getElementById('canvas-area');
        const cyOffset = cyContainer.getBoundingClientRect();
        renameInput.style.left = (cyOffset.left + bb.x1) + 'px';
        renameInput.style.top = (cyOffset.top + bb.y2 + 4) + 'px';
        renameInput.style.display = 'block';
        renameField.focus();
        renameField.select();
      });
      clearTimeout(renameTimeout);
    }

    // --- Edge creation (click node to start connecting, click another to finish) ---
    let connectSource = null;

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      if (connectSource && connectSource !== node) {
        const srcId = connectSource.id();
        const tgtId = node.id();
        if (cy.edges().some(e =>
          (e.data('source') === srcId && e.data('target') === tgtId) ||
          (e.data('source') === tgtId && e.data('target') === srcId)
        )) {
          connectSource.removeClass('connecting');
          connectSource = null;
          cy.elements().unselect();
          return;
        }
        pushUndo();
        const srcKind = connectSource.data('kind');
        const tgtKind = node.data('kind');
        if (tgtKind === 'condition' && cy.edges().some(e => e.data('target') === tgtId)) {
          connectSource.removeClass('connecting');
          connectSource = null;
          cy.elements().unselect();
          return;
        }
        const srcCond = cy.edges().filter(e => e.data('target') === srcId).map(e => e.data('source')).filter(id => cy.getElementById(id).data('kind') === 'condition');
        const tgtCond = cy.edges().filter(e => e.data('target') === tgtId).map(e => e.data('source')).filter(id => cy.getElementById(id).data('kind') === 'condition');
        if (srcCond.some(cid => tgtCond.includes(cid))) {
          connectSource.removeClass('connecting');
          connectSource = null;
          cy.elements().unselect();
          return;
        }
        const edgeData = { source: srcId, target: tgtId };
        if (srcKind === 'condition') {
          const existing = cy.edges().filter(e => e.data('source') === connectSource.id());
          if (existing.length >= 2) {
            connectSource.removeClass('connecting');
            connectSource = null;
            cy.elements().unselect();
            return;
          }
          if (existing.length === 0) {
            edgeData.label = 'if';
          } else {
            edgeData.label = 'else';
          }
        }
        cy.add({ group: 'edges', data: edgeData });
        connectSource.removeClass('connecting');
        connectSource = null;
        cy.elements().unselect();
        node.select();
      } else {
        if (connectSource) connectSource.removeClass('connecting');
        connectSource = node;
        node.addClass('connecting');
        cy.elements().unselect();
        node.select();
      }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy && connectSource) {
        connectSource.removeClass('connecting');
        connectSource = null;
        cy.elements().unselect();
      }
    });

    // --- Double-click to rename ---
    const renameInput = document.getElementById('rename-input');
    const renameField = document.getElementById('rename-field');
    let renameNode = null;
    let renameTimeout = null;

    cy.on('dblclick', 'node', (evt) => {
      renameNode = evt.target;
      labelEdge = null;
      const bb = renameNode.renderedBoundingBox({ includeNodes: true });
      const cyContainer = document.getElementById('canvas-area');
      const cyOffset = cyContainer.getBoundingClientRect();
      renameInput.style.left = (cyOffset.left + bb.x1) + 'px';
      renameInput.style.top = (cyOffset.top + bb.y2 + 4) + 'px';
      renameInput.style.display = 'block';
      renameField.value = renameNode.data('label');
      renameField.focus();
      renameField.select();
      clearTimeout(renameTimeout);
    });

    renameField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (renameNode) {
          const newLabel = renameField.value || renameNode.data('label');
          if (renameNode.data('label') !== newLabel) pushUndo();
          renameNode.data('label', newLabel);
        }
        if (labelEdge) {
          const newLabel = renameField.value || '';
          if ((labelEdge.data('label') || '') !== newLabel) pushUndo();
          labelEdge.data('label', newLabel);
        }
        renameInput.style.display = 'none';
        renameNode = null;
        labelEdge = null;
      } else if (e.key === 'Escape') {
        renameInput.style.display = 'none';
        renameNode = null;
        labelEdge = null;
      }
    });

    renameField.addEventListener('blur', () => {
      renameTimeout = setTimeout(() => {
        if (renameNode) {
          const newLabel = renameField.value || renameNode.data('label');
          if (renameNode.data('label') !== newLabel) pushUndo();
          renameNode.data('label', newLabel);
        }
        if (labelEdge) {
          const newLabel = renameField.value || '';
          if ((labelEdge.data('label') || '') !== newLabel) pushUndo();
          labelEdge.data('label', newLabel);
        }
        renameInput.style.display = 'none';
        renameNode = null;
        labelEdge = null;
      }, 100);
    });

    // --- Right-click to delete ---
    cy.on('cxttap', 'node', (evt) => {
      pushUndo();
      evt.target.connectedEdges().remove();
      evt.target.remove();
      if (connectSource === evt.target) connectSource = null;
    });
    cy.on('cxttap', 'edge', (evt) => {
      pushUndo();
      evt.target.remove();
    });

    // --- Prevent right-click menu ---
    cy.on('cxttap', (e) => {
      if (e.target === cy) e.originalEvent.preventDefault();
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
      if (document.activeElement === renameField) {
        // Allow undo/redo and Escape even while typing a name
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) {
          e.preventDefault();
          if (e.key === 'y' || e.shiftKey) redo(); else undo();
          return;
        }
        if (e.key === 'Escape') {
          // Rename field handler dismisses the input; fall through to cy handler
        } else {
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = cy.$(':selected');
        if (sel.nonempty()) { pushUndo(); sel.forEach(function(el) { el.connectedEdges().remove(); }); sel.remove(); return; }
        if (connectSource) { pushUndo(); connectSource.connectedEdges().remove(); connectSource.removeClass('connecting'); connectSource.remove(); connectSource = null; }
      }
      if (e.key === 'Escape') {
        if (connectSource) { connectSource.removeClass('connecting'); connectSource = null; }
        cy.elements().unselect();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        cy.elements().select();
      }
    });

    // --- Undo/redo ---
    let undoStack = [];
    let redoStack = [];
    const MAX_UNDO = 50;
    function snapshot() {
      return JSON.stringify({ elements: cy.json().elements, counter: nodeCounter });
    }
    function pushUndo() {
      undoStack.push(snapshot());
      if (undoStack.length > MAX_UNDO) undoStack.shift();
      redoStack = [];
    }
    function undo() {
      if (!undoStack.length) return;
      redoStack.push(snapshot());
      restore(undoStack.pop());
    }
    function redo() {
      if (!redoStack.length) return;
      undoStack.push(snapshot());
      restore(redoStack.pop());
    }
    function restore(snap) {
      const data = JSON.parse(snap);
      nodeCounter = data.counter;
      cy.json({ elements: data.elements });
    }

    // --- Edge label: double-click edge ---
    let labelEdge = null;
    cy.on('dblclick', 'edge', (evt) => {
      labelEdge = evt.target;
      const mp = labelEdge.midpoint();
      const cyContainer = document.getElementById('canvas-area');
      const cyOffset = cyContainer.getBoundingClientRect();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const rx = (mp.x - pan.x) * zoom + cy.width() / 2;
      const ry = (mp.y - pan.y) * zoom + cy.height() / 2;
      renameInput.style.left = (cyOffset.left + rx - 40) + 'px';
      renameInput.style.top = (cyOffset.top + ry - 12) + 'px';
      renameInput.style.display = 'block';
      renameField.value = labelEdge.data('label') || '';
      renameField.focus();
      renameField.select();
      renameNode = null;
      clearTimeout(renameTimeout);
    });

    // --- Toolbar actions ---
    document.getElementById('clear-btn').onclick = () => {
      pushUndo();
      cy.elements().remove();
      nodeCounter = 0;
      connectSource = null;
      renameNode = null;
      labelEdge = null;
      renameInput.style.display = 'none';
      renameTimeout && clearTimeout(renameTimeout);
      cy.zoom(1);
      cy.pan({ x: 0, y: 0 });
    };

    function restoreChildren() {
      const groups = new Map();
      cy.nodes().filter(n => n.data('_parent')).forEach(n => {
        const pid = n.data('_parent');
        if (!groups.has(pid)) groups.set(pid, []);
        groups.get(pid).push(n);
      });
      groups.forEach((children, pid) => {
        const p = cy.getElementById(pid);
        if (p.empty()) return;
        children.sort((a, b) => a.position().x - b.position().x);
        const total = children.length;
        const childW = 70, gap = 20;
        const span = total * childW + (total - 1) * gap;
        const startX = p.position().x - span / 2 + childW / 2;
        children.forEach((c, i) => {
          c.position({ x: startX + i * (childW + gap), y: p.position().y + 12 });
        });
      });
    }

    document.getElementById('layout-btn').onclick = () => {
      const edges = cy.edges();
      if (edges.length === 0) {
        const topLevel = cy.nodes().filter(n => !n.data('_parent'));
        topLevel.forEach((node, i) => {
          node.position({ x: snapToGrid(20), y: snapToGrid(20 + i * 60) });
        });
        restoreChildren();
        fitWithMaxZoom(1.5);
      } else {
        const layout = cy.layout({
          name: 'breadthfirst',
          directed: true,
          spacingFactor: 0.65,
          nodeDimensionsIncludeLabels: true,
          avoidOverlap: true,
          animate: true,
          animationDuration: 300,
        });
        layout.promiseOn('layoutstop').then(() => {
          restoreChildren();
          fitWithMaxZoom(1.5);
        });
        layout.run();
      }
    };

    document.getElementById('fit-btn').onclick = () => {
      fitWithMaxZoom();
    };

    document.getElementById('export-btn').onclick = () => {
      const bg = getComputedStyle(document.getElementById('canvas-area')).backgroundColor || '#1e1e1e';
      const png = cy.png({ full: true, bg: bg });
      vscode.postMessage({ type: 'exportPNG', data: png });
    };

    document.getElementById('save-btn').onclick = () => {
      const json = JSON.stringify({ elements: cy.json().elements, counter: nodeCounter });
      vscode.postMessage({ type: 'saveGraph', data: json });
    };

    document.getElementById('load-btn').onclick = () => {
      vscode.postMessage({ type: 'loadGraph' });
    };

    document.getElementById('generate-btn').onclick = () => {
      const graph = cyToWorkflowGraph();
      const language = document.getElementById('palette-language').value;
      vscode.postMessage({
        type: 'generateCode',
        graphJson: JSON.stringify(graph),
        language,
      });
    };

    document.getElementById('preview-btn').onclick = () => {
      const graph = cyToWorkflowGraph();
      const mermaid = graphToMermaid(graph);
      document.getElementById('preview-content').textContent = mermaid;
      document.getElementById('preview-panel').style.display = 'flex';
    };

    document.getElementById('preview-close').onclick = () => {
      document.getElementById('preview-panel').style.display = 'none';
    };

    function graphToMermaid(graph) {
      const lines = ['graph TD'];
      const nodeIds = new Set(graph.nodes.map(n => n.id));

      // Node definitions
      for (const node of graph.nodes) {
        if (node.kind === 'start') continue;
        if (node.kind === 'end') continue;

        var label = (node.label || '').replace(/\|/g, ' ').replace(/"/g, "'");
        var shape;
        switch (node.kind) {
          case 'step': shape = '[' + label + ']'; break;
          case 'invoke': shape = '[/' + label + '\\]'; break;
          case 'parallel': case 'map': shape = '{{' + label + '}}'; break;
          case 'wait': case 'waitForCallback': case 'createCallback': case 'waitForCondition': shape = '((' + label + '))'; break;
          case 'condition': shape = '{' + label + '}'; break;
          case 'runInChildContext': case 'withRetry': shape = '[[' + label + ']]'; break;
          case 'promiseAll': case 'promiseAny': case 'promiseRace': case 'promiseAllSettled': shape = '{{' + label + '}}'; break;
          default: shape = '[' + label + ']';
        }
        lines.push('  ' + node.id + shape);

        // Branch nodes for parallel/map
        if ((node.kind === 'parallel' || node.kind === 'map') && node.branches) {
          var subId = 'sub_' + node.id;
          lines.push('  subgraph ' + subId + '[" "]');
          for (var bi = 0; bi < node.branches.length; bi++) {
            var branch = node.branches[bi];
            for (var bj = 0; bj < branch.nodes.length; bj++) {
              var bn = branch.nodes[bj];
              var blabel = (bn.label || '').replace(/\|/g, ' ').replace(/"/g, "'");
              lines.push('    ' + bn.id + '[' + blabel + ']');
            }
          }
          lines.push('  end');
          lines.push('  style ' + subId + ' fill:transparent,stroke:#444,stroke-width:1px,stroke-dasharray:5 5');
        }
      }

      // Edges
      lines.push('');
      if (graph.edges && graph.edges.length > 0) {
        for (var ei = 0; ei < graph.edges.length; ei++) {
          var edge = graph.edges[ei];
          if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
          var fnode = graph.nodes.find(function(n) { return n.id === edge.from; });
          var tnode = graph.nodes.find(function(n) { return n.id === edge.to; });
          if (fnode && fnode.kind === 'end') continue;
          if (tnode && tnode.kind === 'start') continue;
          var elabel = edge.label ? '|' + edge.label + '|' : '';
          lines.push('  ' + edge.from + ' -->' + elabel + ' ' + edge.to);
        }
      } else {
        // No edges: lay out nodes sequentially
        var workflowNodes = graph.nodes.filter(function(n) { return n.kind !== 'start' && n.kind !== 'end'; });
        for (var wi = 0; wi < workflowNodes.length; wi++) {
          var from = workflowNodes[wi];
          var to = workflowNodes[wi + 1];
          if (to) {
            lines.push('  ' + from.id + ' --> ' + to.id);
          } else {
            lines.push('  ' + from.id + ' --> node_end');
          }
        }
        if (workflowNodes.length > 0) {
          var hasStart = lines.some(function(l) { return l.indexOf('node_start -->') !== -1; });
          if (!hasStart) {
            lines.push('  node_start --> ' + workflowNodes[0].id);
          }
        }
      }

      return lines.join('\\n');
    }

    // --- Convert Cytoscape graph to WorkflowGraph ---
    function cyToWorkflowGraph() {
      const nodes = [];
      const nodeMap = new Map();
      const childMap = new Map();

      cy.nodes().forEach(n => {
        const id = n.data('id');
        const kind = n.data('kind');
        const label = n.data('label');
        const parentId = n.data('_parent');

        nodeMap.set(id, { id, kind, label, origLabel: label });

        if (parentId) {
          const node = nodeMap.get(id);
          node._parent = parentId;
          if (!childMap.has(parentId)) childMap.set(parentId, []);
          childMap.get(parentId).push(node);
        }
      });

      childMap.forEach((children, parentId) => {
        const parent = nodeMap.get(parentId);
        if (parent && (parent.kind === 'parallel' || parent.kind === 'map')) {
          parent.branches = children.map(c => ({
            name: c.label,
            dynamic: false,
            nodes: [{ id: c.id, kind: c.kind, label: c.label }],
          }));
        }
      });

      const rawEdges = [];
      cy.edges().forEach(e => {
        let srcId = e.data('source');
        let tgtId = e.data('target');
        if (!nodeMap.has(srcId) || !nodeMap.has(tgtId)) return;

        const srcNode = nodeMap.get(srcId);
        const tgtNode = nodeMap.get(tgtId);
        if (srcNode._parent && nodeMap.has(srcNode._parent)) srcId = srcNode._parent;
        if (tgtNode._parent && nodeMap.has(tgtNode._parent)) tgtId = tgtNode._parent;
        if (srcId === tgtId) return;
        if (nodeMap.get(srcId)._parent || nodeMap.get(tgtId)._parent) return;

        rawEdges.push({ from: srcId, to: tgtId, label: (e.data('label') === 'else' ? 'no' : e.data('label')) || undefined });
      });

      const inDegree = new Map();
      const adj = new Map();
      nodeMap.forEach((_, id) => { inDegree.set(id, 0); adj.set(id, []); });
      rawEdges.forEach(e => {
        adj.get(e.from).push(e.to);
        inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
      });

      const queue = [];
      inDegree.forEach((deg, id) => { if (deg === 0) queue.push(id); });
      const ordered = [];
      while (queue.length > 0) {
        const u = queue.shift();
        ordered.push(u);
        (adj.get(u) || []).forEach(v => {
          inDegree.set(v, inDegree.get(v) - 1);
          if (inDegree.get(v) === 0) queue.push(v);
        });
      }

      const topLevel = ordered.map(id => nodeMap.get(id)).filter(n => n && !n._parent);

      const edgeAdj = new Map();
      rawEdges.forEach(e => {
        if (!edgeAdj.has(e.from)) edgeAdj.set(e.from, []);
        edgeAdj.get(e.from).push(e.to);
      });

      const condThenNodes = new Map();
      const condElseNodes = new Map();
      const condConvNodes = new Map();
      for (let i = 0; i < topLevel.length; i++) {
        const n = topLevel[i];
        if (n.kind === 'condition') {
          const condId = n.id;
          const noEdge = rawEdges.find(e => e.from === condId && (e.label === 'no' || e.label === 'else'));
          const noTargetId = noEdge ? noEdge.to : null;

          const rawThen = new Set();
          const rawElse = new Set();

          const dfs = (startIds, resultSet) => {
            const visited = new Set();
            const stack = [...startIds];
            while (stack.length > 0) {
              const id = stack.pop();
              if (visited.has(id)) continue;
              visited.add(id);
              const nd = nodeMap.get(id);
              if (nd && !nd._parent) resultSet.add(id);
              if (nd && nd.kind === 'condition') continue;
              (edgeAdj.get(id) || []).forEach(nxt => {
                if (!visited.has(nxt)) stack.push(nxt);
              });
            }
          };

          (edgeAdj.get(condId) || []).forEach(tgt => {
            if (tgt !== noTargetId) dfs([tgt], rawThen);
          });
          if (noTargetId) dfs([noTargetId], rawElse);

          const convSet = new Set();
          rawThen.forEach(id => { if (rawElse.has(id)) convSet.add(id); });
          convSet.forEach(id => { rawThen.delete(id); rawElse.delete(id); });

          n.condition = n.label;
          n.thenCount = Math.max(1, rawThen.size);
          n.thenReturns = false;
          condThenNodes.set(condId, rawThen);
          condElseNodes.set(condId, rawElse);
          condConvNodes.set(condId, convSet);
        }
      }

      const thenIds = new Set();
      const elseIds = new Set();
      const convIds = new Set();
      condThenNodes.forEach(s => s.forEach(id => thenIds.add(id)));
      condElseNodes.forEach(s => s.forEach(id => elseIds.add(id)));
      condConvNodes.forEach(s => s.forEach(id => convIds.add(id)));

      const outputOrder = [];
      const placed = new Set();
      for (const n of topLevel) {
        if (n.kind === 'condition') {
          outputOrder.push(n);
          placed.add(n.id);
          const thenSet = condThenNodes.get(n.id);
          const elseSet = condElseNodes.get(n.id);
          const convSet = condConvNodes.get(n.id);
          const pushGroup = (set) => {
            if (!set) return;
            for (const tn of topLevel) {
              if (set.has(tn.id) && !placed.has(tn.id)) {
                outputOrder.push(tn);
                placed.add(tn.id);
              }
            }
          };
          pushGroup(thenSet);
          pushGroup(elseSet);
          pushGroup(convSet);
        } else if (!thenIds.has(n.id) && !elseIds.has(n.id) && !convIds.has(n.id) && !placed.has(n.id)) {
          outputOrder.push(n);
          placed.add(n.id);
        }
      }
      nodes.push(...outputOrder);

      return {
        name: 'workflow',
        nodes: [
          { id: 'node_start', kind: 'start', label: 'Start' },
          ...nodes,
          { id: 'node_end', kind: 'end', label: 'End' },
        ],
        edges: rawEdges,
      };
    }

    // --- Listen for extension messages (e.g. loaded graph) ---
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'loadGraphData') {
        try {
          const data = JSON.parse(msg.data);
          nodeCounter = data.counter || 0;
          cy.json({ elements: data.elements || [] });
          undoStack = [];
          redoStack = [];
        } catch (_) {}
      }
    });
  </script>
</body>
</html>`
}
