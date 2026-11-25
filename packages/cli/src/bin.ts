import { Command } from 'commander'
import { resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, readFileSync } from 'node:fs'
import { exec, execSync } from 'node:child_process'
import { cardDiagramCss, cardLegendHtml, otelModeLabel, parseFile, renderMermaid, renderOtelTree, type WorkflowOtel } from '@durable-viz/core'
import { version } from '../package.json'

function isWSL(): boolean {
  try {
    const release = readFileSync('/proc/version', 'utf-8')
    return /microsoft|wsl/i.test(release)
  } catch {
    return false
  }
}

/** Get a temp directory that the host OS can open (Windows-side on WSL). */
function getTempDir(): string {
  if (isWSL()) {
    try {
      const winTemp = execSync('cmd.exe /c echo %TEMP%', { stdio: ['pipe', 'pipe', 'ignore'] })
        .toString().trim()
      return execSync(`wslpath ${JSON.stringify(winTemp)}`).toString().trim()
    } catch {
      return tmpdir()
    }
  }
  return tmpdir()
}

function openInBrowser(filePath: string): void {
  const platform = process.platform
  if (isWSL()) {
    const winPath = execSync(`wslpath -w ${JSON.stringify(filePath)}`).toString().trim()
    exec(`cmd.exe /c start "" "${winPath}"`)
  } else if (platform === 'darwin') {
    exec(`open ${JSON.stringify(filePath)}`)
  } else if (platform === 'win32') {
    exec(`start "" ${JSON.stringify(filePath)}`)
  } else {
    exec(`xdg-open ${JSON.stringify(filePath)}`)
  }
}

function buildHtml(mermaid: string, classicMermaid: string, title: string, graphJson: string, otel?: WorkflowOtel, otelTree?: string): string {
  const otelDetail = otel
    ? otel.environmentVariable
      ? `${otel.environmentVariable}${otel.modes?.length ? ` (${otel.modes.join(' or ')})` : ''}`
      : otel.mode
    : ''
  const otelBadge = otel ? `<span class="otel-badge" title="OTel plugin: ${otelDetail}">OTel: ${otelModeLabel(otel)}</span>` : ''
  const otelTab = otelTree ? '<button data-tab="otel">OTel</button>' : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - durable-viz</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      color-scheme: dark light;
      --dv-bg: #0f172a; --dv-fg: #e2e8f0;
      --dv-chrome: #1e293b; --dv-chrome-border: #334155; --dv-chrome-muted: #64748b; --dv-chrome-text: #94a3b8;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --dv-bg: #ffffff; --dv-fg: #1e293b;
        --dv-chrome: #f1f5f9; --dv-chrome-border: #cbd5e1; --dv-chrome-muted: #64748b; --dv-chrome-text: #475569;
      }
    }
    body {
      --dv-card: color-mix(in srgb, var(--dv-fg) 7%, var(--dv-bg));
      --dv-border: color-mix(in srgb, var(--dv-fg) 28%, var(--dv-bg));
      --dv-muted: color-mix(in srgb, var(--dv-fg) 62%, var(--dv-bg));
      --dv-edge: color-mix(in srgb, var(--dv-fg) 45%, var(--dv-bg));
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--dv-bg);
      color: var(--dv-fg);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--dv-chrome);
      flex-shrink: 0;
    }
    h1 {
      font-size: 1.1rem;
      font-weight: 500;
      color: var(--dv-chrome-text);
    }
    h1 span { color: var(--dv-fg); }
    .otel-badge { display: inline-block; margin-left: 0.6rem; padding: 0.15rem 0.45rem; border: 1px solid var(--dv-chrome-border); border-radius: 999px; color: var(--dv-chrome-text); font-size: 0.7rem; font-weight: 500; white-space: nowrap; }
    .controls {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .controls button {
      background: var(--dv-chrome);
      border: 1px solid var(--dv-chrome-border);
      color: var(--dv-fg);
      padding: 0.3rem 0.7rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .controls button:hover { background: var(--dv-chrome-border); }
    .controls span { color: var(--dv-chrome-muted); font-size: 0.8rem; }
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
    ${cardDiagramCss()}
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid var(--dv-chrome);
      flex-shrink: 0;
      padding: 0.5rem 1.5rem;
    }
    .legend {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      font-size: 0.75rem;
      color: var(--dv-chrome-muted);
    }
    footer a {
      color: var(--dv-chrome-muted);
      font-size: 0.75rem;
      text-decoration: none;
    }
    footer a:hover { color: var(--dv-chrome-text); }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .source-panel {
      display: none;
      position: absolute;
      inset: 0;
      background: var(--dv-bg);
      z-index: 10;
      flex-direction: column;
    }
    .source-panel.visible { display: flex; }
    .source-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--dv-chrome);
      flex-shrink: 0;
    }
    .source-tabs button {
      background: none;
      border: none;
      color: var(--dv-chrome-muted);
      padding: 0.5rem 1rem;
      cursor: pointer;
      font-size: 0.8rem;
      border-bottom: 2px solid transparent;
    }
    .source-tabs button.active { color: var(--dv-fg); border-bottom-color: var(--dv-fg); }
    .source-content {
      flex: 1;
      overflow: auto;
      padding: 1rem;
      font-family: monospace;
      font-size: 0.8rem;
      white-space: pre;
      color: var(--dv-fg);
    }
  </style>
</head>
<body>
  <header>
    <h1>durable-viz: <span>${title}</span>${otelBadge}</h1>
    <div class="controls">
      <button id="zoom-out">-</button>
      <span id="zoom-level">100%</span>
      <button id="zoom-in">+</button>
      <button id="zoom-fit">Fit</button>
      <button id="toggle-direction">LR</button>
      <button id="download-png">Save PNG</button>
      <button id="toggle-source">Source</button>
    </div>
  </header>
  <div class="diagram-container" id="container">
    <div class="diagram-wrapper" id="wrapper">
      <pre class="mermaid">
${mermaid.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </pre>
    </div>
    <div class="source-panel" id="source-panel">
      <div class="source-tabs">
        <button class="active" data-tab="mermaid">Mermaid</button>
        ${otelTab}
        <button data-tab="json">JSON</button>
      </div>
      <div class="source-content" id="source-content"></div>
    </div>
  </div>
  <footer>
    <div class="legend">
      ${cardLegendHtml()}
    </div>
    <a href="https://github.com/gunnargrosch/durable-viz" target="_blank">github.com/gunnargrosch/durable-viz</a>
  </footer>
  <script type="application/json" id="graph-json">${graphJson}</script>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({
      startOnLoad: true,
      theme: window.matchMedia('(prefers-color-scheme: light)').matches ? 'default' : 'dark',
      flowchart: { curve: 'basis', padding: 12, nodeSpacing: 40, rankSpacing: 50, htmlLabels: true },
      themeVariables: { nodePadding: 12 },
    });

    const wrapper = document.getElementById('wrapper');
    const zoomLabel = document.getElementById('zoom-level');
    const container = document.getElementById('container');

    let mermaidRaw = document.querySelector('.mermaid').textContent.trim();
    let classicRaw = ${JSON.stringify(classicMermaid)};
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
      const fitScale = Math.min(cw / sw, ch / sh) * 0.85;
      scale = fitScale;
      panX = (cw - sw * scale) / 2;
      panY = (ch - sh * scale) / 2;
      applyTransform();
    }

    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom(scale * delta, cx, cy);
    }, { passive: false });

    container.addEventListener('mousedown', (e) => {
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
      classicRaw = isLR ? classicRaw.replace(/^graph LR/, 'graph TD') : classicRaw.replace(/^graph TD/, 'graph LR');
      btn.textContent = isLR ? 'LR' : 'TD';
      mermaidEl.removeAttribute('data-processed');
      mermaidEl.textContent = mermaidRaw;
      wrapper.classList.remove('ready');
      scale = 1; panX = 0; panY = 0; applyTransform();
      await mermaid.run({ nodes: [mermaidEl] });
      requestAnimationFrame(() => { fitToView(); wrapper.classList.add('ready'); });
    };

    // Standalone SVG images do not see page CSS, so copy computed styles onto a clone before export.
    const EXPORT_PADDING = 24;
    const SKIP_PROPS = new Set(['transform', 'transform-origin', 'perspective-origin', 'inline-size', 'block-size', 'x', 'y', 'cx', 'cy', 'd']);
    function serializeWithStyles(svg) {
      const clone = svg.cloneNode(true);
      const originals = [svg, ...svg.querySelectorAll('*')];
      const copies = [clone, ...clone.querySelectorAll('*')];
      originals.forEach((el, i) => {
        const computed = getComputedStyle(el);
        const isSvgEl = el instanceof SVGElement;
        let css = '';
        for (const prop of computed) {
          if (SKIP_PROPS.has(prop)) continue;
          if (isSvgEl && (prop === 'width' || prop === 'height')) continue;
          css += prop + ':' + computed.getPropertyValue(prop) + ';';
        }
        copies[i].setAttribute('style', css);
      });
      const vb = svg.viewBox.baseVal;
      const width = vb.width || svg.clientWidth;
      const height = vb.height || svg.clientHeight;
      const fullWidth = width + EXPORT_PADDING * 2;
      const fullHeight = height + EXPORT_PADDING * 2;
      clone.removeAttribute('style');
      clone.setAttribute('viewBox', (vb.x - EXPORT_PADDING) + ' ' + (vb.y - EXPORT_PADDING) + ' ' + fullWidth + ' ' + fullHeight);
      clone.setAttribute('width', fullWidth);
      clone.setAttribute('height', fullHeight);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      background.setAttribute('x', vb.x - EXPORT_PADDING);
      background.setAttribute('y', vb.y - EXPORT_PADDING);
      background.setAttribute('width', fullWidth);
      background.setAttribute('height', fullHeight);
      background.setAttribute('fill', getComputedStyle(document.body).backgroundColor);
      clone.insertBefore(background, clone.firstChild);
      return new XMLSerializer().serializeToString(clone);
    }

    document.getElementById('download-png').onclick = () => {
      const svg = wrapper.querySelector('svg');
      if (!svg) return;
      const svgData = serializeWithStyles(svg);
      const canvas = document.createElement('canvas');
      const scale = 4;
      const bb = svg.viewBox.baseVal;
      const sw = (bb.width || svg.clientWidth) + EXPORT_PADDING * 2;
      const sh = (bb.height || svg.clientHeight) + EXPORT_PADDING * 2;
      canvas.width = sw * scale;
      canvas.height = sh * scale;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const a = document.createElement('a');
        a.download = '${title}-durable-viz.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
    };

    function getMermaidSource() { return classicRaw; }
    const jsonSource = document.getElementById('graph-json').textContent;
    const otelSource = ${JSON.stringify(otelTree ?? '')};
    const sourcePanel = document.getElementById('source-panel');
    const sourceContent = document.getElementById('source-content');
    let activeTab = 'mermaid';

    document.querySelectorAll('.source-tabs button').forEach(btn => {
      btn.onclick = () => {
        document.querySelector('.source-tabs .active').classList.remove('active');
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        sourceContent.textContent = activeTab === 'mermaid' ? getMermaidSource() : activeTab === 'otel' ? otelSource : jsonSource;
      };
    });

    const toggleBtn = document.getElementById('toggle-source');
    toggleBtn.onclick = () => {
      const visible = sourcePanel.classList.toggle('visible');
      toggleBtn.textContent = visible ? 'Diagram' : 'Source';
      if (visible) sourceContent.textContent = activeTab === 'mermaid' ? getMermaidSource() : activeTab === 'otel' ? otelSource : jsonSource;
    };

    setTimeout(() => {
      fitToView();
      wrapper.classList.add('ready');
    }, 500);
  </script>
</body>
</html>`
}

const program = new Command()
  .name('durable-viz')
  .description('Visualize AWS Lambda Durable Functions workflows')
  .version(version)
  .argument('<file>', 'Path to a file containing a durable function handler')
  .option('-d, --direction <dir>', 'Graph direction: TD (top-down) or LR (left-right)', 'TD')
  .option('-n, --name <name>', 'Override the workflow name')
  .option('--json', 'Output the raw workflow graph as JSON instead of Mermaid')
  .option('-o, --open', 'Open the diagram in your browser')
  .action((file: string, options: { direction: string; name?: string; json?: boolean; open?: boolean }) => {
    const filePath = resolve(file)

    try {
      const graph = parseFile(filePath, { name: options.name })

      if (options.json) {
        console.log(JSON.stringify(graph, null, 2))
        return
      }

      const direction = options.direction as 'TD' | 'LR'
      const mermaid = renderMermaid(graph, { direction })
      const cardMermaid = renderMermaid(graph, { direction, style: 'card' })

      if (options.open) {
        const title = options.name ?? basename(filePath, '.ts')
        const html = buildHtml(cardMermaid, mermaid, title, JSON.stringify(graph, null, 2), graph.otel, renderOtelTree(graph))
        const tmpPath = resolve(getTempDir(), `durable-viz-${Date.now()}.html`)
        writeFileSync(tmpPath, html)
        openInBrowser(tmpPath)
        console.log(`Opened: ${tmpPath}`)
      } else {
        console.log(mermaid)
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  })

program.parse()
