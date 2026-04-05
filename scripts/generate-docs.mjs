#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const clientSchema = JSON.parse(readFileSync('docs/client-messages.schema.json', 'utf8'));
const serverSchema = JSON.parse(readFileSync('docs/server-messages.schema.json', 'utf8'));

function renderType(prop) {
    if (prop.const) return `"${prop.const}"`;
    if (prop.enum) return prop.enum.map(v => `"${v}"`).join(' | ');
    if (prop.type === 'array' && prop.items) return `${renderType(prop.items)}[]`;
    if (prop.type) return prop.type;
    if (prop.anyOf) return prop.anyOf.map(renderType).join(' | ');
    if (prop.$ref) return prop.$ref.replace('#/definitions/', '');
    return 'unknown';
}

function getMessages(schema) {
    const defs = schema.definitions ?? {};
    const unionName = schema.$ref?.replace('#/definitions/', '');
    return Object.entries(defs)
        .filter(([name]) => name !== unionName)
        .sort(([, a], [, b]) => {
            const aType = a.properties?.type?.const ?? '';
            const bType = b.properties?.type?.const ?? '';
            return aType.localeCompare(bType);
        });
}

function renderSidebarTree(label, id, messages) {
    const items = messages
        .map(([name, def]) => {
            const wire = def.properties?.type?.const ?? '?';
            return `        <li><a href="#${name}" class="nav-link" data-target="${name}"><code>${wire}</code> <span class="nav-name">${name.replace('Message', '')}</span></a></li>`;
        })
        .join('\n');

    return `      <li class="tree-branch">
        <button class="tree-toggle" aria-expanded="true" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded')==='true'?'false':'true')">
          <svg class="chevron" width="12" height="12" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span class="tree-label">${label}</span>
          <span class="tree-count">${messages.length}</span>
        </button>
        <ul class="tree-children" id="${id}">
${items}
        </ul>
      </li>`;
}

function renderMessageCard(name, def) {
    const wireType = def.properties?.type?.const ?? '?';
    const required = new Set(def.required ?? []);
    const props = Object.entries(def.properties ?? {})
        .map(([key, prop]) => {
            const opt = required.has(key) ? '' : '?';
            return `  <span class="key">${key}${opt}</span>: <span class="type">${renderType(prop)}</span>`;
        })
        .join('\n');

    return `<section class="message" id="${name}">
<h3><a href="#${name}">${name}</a> <code class="wire-type">"${wireType}"</code></h3>
<pre>{
${props}
}</pre>
</section>`;
}

function renderMainSection(title, id, messages) {
    const cards = messages.map(([name, def]) => renderMessageCard(name, def)).join('\n');
    return `<section class="group" id="${id}-section">
  <h2>${title}</h2>
  ${cards}
</section>`;
}

const clientMessages = getMessages(clientSchema);
const serverMessages = getMessages(serverSchema);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>twnr Protocol Reference</title>
<style>
  :root {
    --bg: #1a1a2e;
    --fg: #e0e0e0;
    --fg-dim: #888;
    --accent: #e94560;
    --card: #16213e;
    --border: #0f3460;
    --sidebar-bg: #121a30;
    --sidebar-w: 260px;
    --key: #e94560;
    --type: #4ec9b0;
    --wire: #ce9178;
    --hover: #1e2d4d;
    --active: #253555;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; scroll-padding-top: 1rem; }
  body {
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.6;
    display: flex;
    min-height: 100vh;
  }

  /* Sidebar */
  .sidebar {
    position: fixed;
    top: 0; left: 0;
    width: var(--sidebar-w);
    height: 100vh;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border);
    overflow-y: auto;
    padding: 1.25rem 0;
    font-size: 0.8rem;
    z-index: 10;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .sidebar-title {
    color: var(--accent);
    font-size: 0.95rem;
    font-weight: 700;
    padding: 0 1rem 0.75rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.5rem;
  }
  .tree { list-style: none; }
  .tree-branch { margin-bottom: 0.25rem; }
  .tree-toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.35rem 1rem;
    background: none;
    border: none;
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
  }
  .tree-toggle:hover { background: var(--hover); }
  .chevron {
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .tree-toggle[aria-expanded="true"] .chevron { transform: rotate(90deg); }
  .tree-toggle[aria-expanded="false"] + .tree-children { display: none; }
  .tree-count {
    color: var(--fg-dim);
    font-weight: normal;
    margin-left: auto;
    font-size: 0.75rem;
  }
  .tree-children {
    list-style: none;
    padding-left: 0;
  }
  .tree-children li { }
  .nav-link {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.2rem 1rem 0.2rem 2rem;
    color: var(--fg-dim);
    text-decoration: none;
    transition: background 0.1s, color 0.1s;
  }
  .nav-link:hover { background: var(--hover); color: var(--fg); }
  .nav-link.active { background: var(--active); color: var(--fg); }
  .nav-link code {
    color: var(--wire);
    font-size: 0.7rem;
    flex-shrink: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nav-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Main content */
  .main {
    margin-left: var(--sidebar-w);
    flex: 1;
    padding: 2rem 2.5rem;
    max-width: 750px;
  }
  h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 1.4rem; }
  .subtitle { color: var(--fg-dim); margin-bottom: 2.5rem; font-size: 0.85rem; }
  h2 {
    color: var(--fg);
    margin: 2.5rem 0 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--border);
    font-size: 1.1rem;
  }
  h3 { font-size: 0.95rem; margin-bottom: 0.4rem; }
  h3 a { color: var(--fg); text-decoration: none; }
  h3 a:hover { text-decoration: underline; }
  .wire-type { color: var(--wire); font-size: 0.8rem; font-weight: normal; }
  .message {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.9rem 1.1rem;
    margin-bottom: 0.75rem;
  }
  pre { font-size: 0.8rem; line-height: 1.75; white-space: pre-wrap; }
  .key { color: var(--key); }
  .type { color: var(--type); }
</style>
</head>
<body>

<nav class="sidebar">
  <div class="sidebar-title">twnr Protocol</div>
  <ul class="tree">
${renderSidebarTree('Client &rarr; Server', 'nav-client', clientMessages)}
${renderSidebarTree('Server &rarr; Client', 'nav-server', serverMessages)}
  </ul>
</nav>

<main class="main">
  <h1>Protocol Reference</h1>
  <p class="subtitle">WebSocket message types &mdash; generated from TypeScript source</p>
  ${renderMainSection('Client &rarr; Server', 'client', clientMessages)}
  ${renderMainSection('Server &rarr; Client', 'server', serverMessages)}
</main>

<script>
// Highlight active sidebar link on scroll
const links = document.querySelectorAll('.nav-link');
const sections = [...links].map(l => document.getElementById(l.dataset.target)).filter(Boolean);

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      links.forEach(l => l.classList.toggle('active', l.dataset.target === entry.target.id));
    }
  }
}, { rootMargin: '-10% 0px -80% 0px' });

sections.forEach(s => observer.observe(s));
</script>
</body>
</html>`;

writeFileSync('docs/index.html', html);
console.log('Generated docs/index.html');
