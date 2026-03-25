#!/usr/bin/env node

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
      min-height: 100vh;
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
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .diagram-wrapper {
      transform-origin: center center;
      transition: transform 0.15s ease;
    }
    .mermaid {
      background: #1e293b;
      border-radius: 12px;
      padding: 2rem 3rem;
    }
    .mermaid svg {
      max-width: none !important;
      height: auto !important;
    }
    .mermaid .node .label { padding: 8px 12px; }
    .legend {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
      padding: 0.75rem 1.5rem;
      font-size: 0.75rem;
      color: #64748b;
      border-top: 1px solid #1e293b;
      flex-shrink: 0;
    }
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
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      flowchart: { curve: 'basis', padding: 15, nodeSpacing: 30, rankSpacing: 40 },
      themeVariables: { nodePadding: 12 },
    });

    let scale = 1;
    const wrapper = document.getElementById('wrapper');
    const label = document.getElementById('zoom-level');
    const container = document.getElementById('container');

    function setZoom(s) {
      scale = Math.max(0.25, Math.min(4, s));
      wrapper.style.transform = 'scale(' + scale + ')';
      label.textContent = Math.round(scale * 100) + '%';
    }

    document.getElementById('zoom-in').onclick = () => setZoom(scale + 0.25);
    document.getElementById('zoom-out').onclick = () => setZoom(scale - 0.25);
    document.getElementById('zoom-fit').onclick = () => {
      const svg = wrapper.querySelector('svg');
      if (!svg) return;
      const hRatio = container.clientWidth / svg.clientWidth;
      const vRatio = container.clientHeight / svg.clientHeight;
      setZoom(Math.min(hRatio, vRatio) * 0.9);
    };

    container.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoom(scale + (e.deltaY < 0 ? 0.1 : -0.1));
      }
    }, { passive: false });

    // Auto-fit after Mermaid renders
    setTimeout(() => document.getElementById('zoom-fit').click(), 500);
  </script>
</body>
</html>`
}

const program = new Command()
  .name('durable-viz')
  .description('Visualize AWS Lambda Durable Functions workflows')
  .version('0.1.0')
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
