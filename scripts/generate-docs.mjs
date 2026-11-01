#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const clientSchema = JSON.parse(readFileSync('docs/client-envelopes.schema.json', 'utf8'));
const serverSchema = JSON.parse(readFileSync('docs/server-envelopes.schema.json', 'utf8'));

const HANDLERS_DIR = 'packages/server/src/handlers';
const routerSrc = readFileSync(join(HANDLERS_DIR, 'message-router.ts'), 'utf8');
const pascal = (wire) => (wire ? wire.charAt(0).toUpperCase() + wire.slice(1) : '?');

// Imports the built shared dist — build @twnr/shared first.
const { Commands, Events } = await import('../packages/shared/dist/index.js');

const clientWireToTypeName = Object.fromEntries(
    Object.entries(Commands).map(([key, def]) => [def.name, `CommandRequest<'${key}'>`]),
);
const serverWireToTypeName = {};
for (const [key, def] of Object.entries(Commands)) {
    // Shared replies (e.g. haggleResponseResult) keep the first command that names them.
    if (def.reply) serverWireToTypeName[def.reply.name] ??= `CommandReply<'${key}'>`;
}
for (const [key, def] of Object.entries(Events)) serverWireToTypeName[def.name] = `EventPayload<'${key}'>`;

function unionMembers(schema) {
    return schema.oneOf ?? schema.anyOf ?? [];
}

function parseRouterImports(src) {
    const map = {};
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
        const file = m[2].replace('.js', '.ts');
        for (const fn of m[1].split(',').map(s => s.trim()).filter(Boolean)) map[fn] = file;
    }
    return map;
}

// Per handler function: the events it sends and the serve* helpers it calls.
function parseHandlerFunctions(importMap) {
    const handlerFiles = new Set(Object.values(importMap));
    handlerFiles.add('message-router.ts');
    const info = {};
    for (const file of handlerFiles) {
        const src = readFileSync(join(HANDLERS_DIR, file), 'utf8');
        const fnRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)[^{]*\{/g;
        let match;
        const fnStarts = [];
        while ((match = fnRegex.exec(src)) !== null) fnStarts.push({ name: match[1], start: match.index });
        for (let i = 0; i < fnStarts.length; i++) {
            const start = fnStarts[i].start;
            const end = i + 1 < fnStarts.length ? fnStarts[i + 1].start : src.length;
            const body = src.slice(start, end);
            const eventKeys = new Set();
            for (const m of body.matchAll(/Events\.(\w+)\.name/g)) eventKeys.add(m[1]);
            const calls = new Set();
            for (const m of body.matchAll(/\b(serve\w+)\s*\(/g)) { if (m[1] !== fnStarts[i].name) calls.add(m[1]); }
            info[fnStarts[i].name] = { file, eventKeys, calls };
        }
    }
    return info;
}

const importMap = parseRouterImports(routerSrc);
const fnInfo = parseHandlerFunctions(importMap);

function resolveEventKeys(fnName, visited = new Set()) {
    const info = fnInfo[fnName];
    if (!info) return new Set();
    visited.add(fnName);
    const keys = new Set(info.eventKeys);
    for (const callee of info.calls) {
        if (!visited.has(callee)) for (const k of resolveEventKeys(callee, visited)) keys.add(k);
    }
    return keys;
}

// The router is a `const handlers: HandlerMap = { CommandName: serveX, ... }` object map.
function parseDispatch(src) {
    const map = {};
    const handlersBlock = src.slice(src.indexOf('const handlers'));
    for (const m of handlersBlock.matchAll(/^\s+(\w+):[^\n]*?\b(serve\w+)/gm)) {
        const def = Commands[m[1]];
        if (def) map[def.name] = { fn: m[2], file: importMap[m[2]] || 'message-router.ts' };
    }
    return map;
}

const dispatch = parseDispatch(routerSrc);

function buildTableRows() {
    const rows = [];
    for (const [key, def] of Object.entries(Commands)) {
        const wire = def.name;
        const d = dispatch[wire];
        const handlerFn = d?.fn || '(missing)';
        const reply = def.reply
            ? { wire: def.reply.name, typeName: serverWireToTypeName[def.reply.name] }
            : null;
        const events = [...(d?.fn ? resolveEventKeys(d.fn) : [])]
            .filter((k) => Events[k])
            .map((k) => ({ wire: Events[k].name, typeName: serverWireToTypeName[Events[k].name] }));
        rows.push({ clientTypeName: `CommandRequest<'${key}'>`, clientWire: wire, handlerFn, reply, events });
    }
    return rows.sort((a, b) => a.clientWire.localeCompare(b.clientWire));
}

const tableRows = buildTableRows();

function getWireType(def) {
    // Simple type: { properties: { type: { const: "foo" } } }
    if (def.properties?.type?.const) return def.properties.type.const;
    // Compound type (discriminated union): { oneOf|anyOf: [ ...variants ] },
    // possibly nested — recurse into the first variant that carries a const.
    const variants = def.oneOf ?? def.anyOf;
    if (variants) {
        for (const variant of variants) {
            const w = getWireType(variant);
            if (w) return w;
        }
    }
    return null;
}

function renderType(prop) {
    if (prop.const) return `"${prop.const}"`;
    if (prop.enum) return prop.enum.map(v => `"${v}"`).join(' | ');
    if (prop.type === 'array' && prop.items) return `${renderType(prop.items)}[]`;
    if (prop.type) return prop.type;
    if (prop.anyOf) return prop.anyOf.map(renderType).join(' | ');
    if (prop.$ref) return prop.$ref.replace('#/definitions/', '');
    return 'unknown';
}

function getMessages(schema, wireToTypeName) {
    return unionMembers(schema)
        .map((def) => {
            const wire = getWireType(def);
            return [wireToTypeName[wire] ?? pascal(wire), def];
        })
        .sort(([, a], [, b]) => (getWireType(a) ?? '').localeCompare(getWireType(b) ?? ''));
}

function renderSidebarTree(label, id, messages) {
    const items = messages.map(([name, def]) => {
        const wire = getWireType(def) ?? '?';
        return `        <li><a href="#${name}" class="nav-link" data-target="${name}"><code>${wire}</code> <span class="nav-name">${name.replace('Message', '')}</span></a></li>`;
    }).join('\n');
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

function renderMessageCard(name, def, isClient) {
    const wireType = getWireType(def) ?? '?';
    const required = new Set(def.required ?? []);
    const props = Object.entries(def.properties ?? {})
        .map(([key, prop]) => {
            const opt = required.has(key) ? '' : '?';
            return `  <span class="key">${key}${opt}</span>: <span class="type">${renderType(prop)}</span>`;
        }).join('\n');
    let handlerHtml = '';
    if (isClient) {
        const d = dispatch[wireType];
        if (d) {
            const label = d.fn ? d.fn : 'inline';
            const file = d.file || 'message-router.ts';
            handlerHtml = `\n<div class="handler">Handler: <code>${label}</code> <span class="handler-file">${file}</span></div>`;
        }
    }
    return `<section class="message" id="${name}">
<h3><a href="#${name}">${name}</a> <code class="wire-type">"${wireType}"</code></h3>${handlerHtml}
<pre>{
${props}
}</pre>
</section>`;
}

function renderMainSection(title, id, messages, isClient) {
    const cards = messages.map(([name, def]) => renderMessageCard(name, def, isClient)).join('\n');
    return `<section class="group" id="${id}-section">
  <h2>${title}</h2>
  ${cards}
</section>`;
}

function renderMappingTable() {
    const link = (rt) => `<a href="#${rt.typeName}" class="response-link">${rt.typeName}</a>`;
    const rows = tableRows.map(r => {
        const reply = r.reply ? link(r.reply) : '<span class="dim">none</span>';
        const events = r.events.length > 0 ? r.events.map(link).join(', ') : '<span class="dim">&mdash;</span>';
        const handler = r.handlerFn === '(missing)'
            ? '<span class="dim">missing</span>'
            : `<code class="fn">${r.handlerFn}</code>`;
        return `      <tr>
        <td><a href="#${r.clientTypeName}">${r.clientTypeName}</a></td>
        <td><code class="wire">${r.clientWire}</code></td>
        <td>${handler}</td>
        <td>${reply}</td>
        <td>${events}</td>
      </tr>`;
    }).join('\n');

    return `<section class="group" id="mapping-section">
  <h2>Message Flow</h2>
  <p class="table-subtitle">Client command &rarr; handler &rarr; reply (every reply also has a <code>refused</code> outcome) and the events the handler may push to any player</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Command</th><th>Wire</th><th>Handler</th><th>Reply</th><th>Events</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</section>`;
}

const clientMessages = getMessages(clientSchema, clientWireToTypeName);
const serverMessages = getMessages(serverSchema, serverWireToTypeName);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>twnr Protocol Reference</title>
<style>
  :root {
    --bg: #1a1a2e; --fg: #e0e0e0; --fg-dim: #888; --accent: #e94560;
    --card: #16213e; --border: #0f3460; --sidebar-bg: #121a30; --sidebar-w: 260px;
    --key: #e94560; --type: #4ec9b0; --wire: #ce9178;
    --hover: #1e2d4d; --active: #253555; --fn: #dcdcaa;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; scroll-padding-top: 1rem; }
  body {
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    background: var(--bg); color: var(--fg); line-height: 1.6;
    display: flex; min-height: 100vh;
  }
  .sidebar {
    position: fixed; top: 0; left: 0; width: var(--sidebar-w); height: 100vh;
    background: var(--sidebar-bg); border-right: 1px solid var(--border);
    overflow-y: auto; padding: 1.25rem 0; font-size: 0.8rem; z-index: 10;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .sidebar-title {
    color: var(--accent); font-size: 0.95rem; font-weight: 700;
    padding: 0 1rem 0.75rem; border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;
  }
  .tree { list-style: none; }
  .tree-branch { margin-bottom: 0.25rem; }
  .tree-toggle {
    display: flex; align-items: center; gap: 0.4rem; width: 100%;
    padding: 0.35rem 1rem; background: none; border: none; color: var(--fg);
    font: inherit; font-weight: 600; font-size: 0.8rem; cursor: pointer; text-align: left;
  }
  .tree-toggle:hover { background: var(--hover); }
  .chevron { transition: transform 0.15s ease; flex-shrink: 0; }
  .tree-toggle[aria-expanded="true"] .chevron { transform: rotate(90deg); }
  .tree-toggle[aria-expanded="false"] + .tree-children { display: none; }
  .tree-count { color: var(--fg-dim); font-weight: normal; margin-left: auto; font-size: 0.75rem; }
  .tree-children { list-style: none; padding-left: 0; }
  .nav-link {
    display: flex; align-items: baseline; gap: 0.5rem;
    padding: 0.2rem 1rem 0.2rem 2rem; color: var(--fg-dim); text-decoration: none;
    transition: background 0.1s, color 0.1s;
  }
  .nav-link:hover { background: var(--hover); color: var(--fg); }
  .nav-link.active { background: var(--active); color: var(--fg); }
  .nav-link code { color: var(--wire); font-size: 0.7rem; flex-shrink: 0; }
  .nav-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main { margin-left: var(--sidebar-w); flex: 1; padding: 2rem 2.5rem; min-width: 0; }
  h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 1.4rem; }
  .subtitle { color: var(--fg-dim); margin-bottom: 2.5rem; font-size: 0.85rem; }
  h2 { color: var(--fg); margin: 2.5rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid var(--border); font-size: 1.1rem; }
  h3 { font-size: 0.95rem; margin-bottom: 0.4rem; }
  h3 a { color: var(--fg); text-decoration: none; }
  h3 a:hover { text-decoration: underline; }
  .wire-type { color: var(--wire); font-size: 0.8rem; font-weight: normal; }
  .handler { font-size: 0.78rem; color: var(--fg-dim); margin-bottom: 0.4rem; }
  .handler code { color: var(--fn); font-size: 0.78rem; }
  .handler-file { color: #6a7a8a; font-size: 0.72rem; }
  .message { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 0.9rem 1.1rem; margin-bottom: 0.75rem; }
  pre { font-size: 0.8rem; line-height: 1.75; white-space: pre-wrap; }
  .key { color: var(--key); }
  .type { color: var(--type); }
  .table-subtitle { color: var(--fg-dim); font-size: 0.8rem; margin-bottom: 1rem; }
  .table-subtitle code { color: var(--wire); font-size: 0.78rem; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.75rem; line-height: 1.5; }
  th { text-align: left; padding: 0.5rem 0.5rem; border-bottom: 2px solid var(--border); color: var(--fg-dim); font-weight: 600; white-space: nowrap; }
  td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  tr:hover td { background: var(--hover); }
  td a { color: var(--fg); text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .response-link { color: var(--type); }
  .response-link:hover { color: var(--fg); }
  code.wire { color: var(--wire); }
  code.fn { color: var(--fn); }
  code.mode { color: #569cd6; font-size: 0.73rem; }
  kbd { color: var(--fg); background: #1e2d4d; border: 1px solid var(--border); border-radius: 3px; padding: 0.05rem 0.35rem; font-family: inherit; font-size: 0.73rem; white-space: nowrap; }
  .dim { color: #555; font-style: italic; }
</style>
</head>
<body>

<nav class="sidebar">
  <div class="sidebar-title">twnr Protocol</div>
  <ul class="tree">
    <li class="tree-branch">
      <a href="#mapping-section" class="nav-link" style="padding-left:1rem; font-weight:600; color:var(--fg);">Message Flow</a>
    </li>
${renderSidebarTree('Client &rarr; Server', 'nav-client', clientMessages)}
${renderSidebarTree('Server &rarr; Client', 'nav-server', serverMessages)}
  </ul>
</nav>

<main class="main">
  <h1>Protocol Reference</h1>
  <p class="subtitle">WebSocket message types &mdash; generated from TypeScript source</p>
  ${renderMappingTable()}
  ${renderMainSection('Client &rarr; Server', 'client', clientMessages, true)}
  ${renderMainSection('Server &rarr; Client', 'server', serverMessages, false)}
</main>

<script>
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
