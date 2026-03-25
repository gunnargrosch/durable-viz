import { Command } from 'commander'
import { resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, readFileSync } from 'node:fs'
import { exec, execSync } from 'node:child_process'
import { parseFile, renderMermaid } from '@durable-viz/core'

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

function buildHtml(mermaid: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - durable-viz</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
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
      border-bottom: 1px solid #1e293b;
      flex-shrink: 0;
    }
    h1 {
      font-size: 1.1rem;
      font-weight: 500;
      color: #94a3b8;
    }
    h1 span { color: #e2e8f0; }
    .controls {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .controls button {
      background: #1e293b;
      border: 1px solid #334155;
      color: #e2e8f0;
      padding: 0.3rem 0.7rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .controls button:hover { background: #334155; }
    .controls span { color: #64748b; font-size: 0.8rem; }
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
    .mermaid .node .label { padding: 8px 12px; }
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid #1e293b;
      flex-shrink: 0;
      padding: 0.5rem 1.5rem;
    }
    .legend {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      font-size: 0.75rem;
      color: #64748b;
    }
    footer a {
      color: #64748b;
      font-size: 0.75rem;
      text-decoration: none;
    }
    footer a:hover { color: #94a3b8; }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .legend-swatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <header>
    <h1>durable-viz: <span>${title}</span></h1>
    <div class="controls">
      <button id="zoom-out">-</button>
      <span id="zoom-level">100%</span>
      <button id="zoom-in">+</button>
      <button id="zoom-fit">Fit</button>
      <button id="download-png">Save PNG</button>
    </div>
  </header>
  <div class="diagram-container" id="container">
    <div class="diagram-wrapper" id="wrapper">
      <pre class="mermaid">
${mermaid}
      </pre>
    </div>
  </div>
  <footer>
    <div class="legend">
      <div class="legend-item"><div class="legend-swatch" style="background:#5b8ab4"></div> Start / End</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#4a8c72"></div> Step</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#b8873a"></div> Invoke</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#7b6b9e"></div> Parallel / Map</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#b05a5a"></div> Wait / Callback</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#6b71a8"></div> Condition</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#4a849e"></div> Child Context</div>
    </div>
    <a href="https://github.com/gunnargrosch/durable-viz" target="_blank">github.com/gunnargrosch/durable-viz</a>
  </footer>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      flowchart: { curve: 'basis', padding: 15, nodeSpacing: 30, rankSpacing: 40 },
      themeVariables: { nodePadding: 12 },
    });

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

    document.getElementById('download-png').onclick = () => {
      const svg = wrapper.querySelector('svg');
      if (!svg) return;
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = svg.clientWidth * scale;
      canvas.height = svg.clientHeight * scale;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const a = document.createElement('a');
        a.download = '${title}-durable-viz.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData);
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
  .version('0.1.2')
  .argument('<file>', 'Path to a TypeScript file containing a durable function handler')
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

      if (options.open) {
        const title = options.name ?? basename(filePath, '.ts')
        const html = buildHtml(mermaid, title)
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
