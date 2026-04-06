#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const clientSchema = JSON.parse(readFileSync('docs/client-messages.schema.json', 'utf8'));
const serverSchema = JSON.parse(readFileSync('docs/server-messages.schema.json', 'utf8'));

const HANDLERS_DIR = 'packages/server/src/handlers';
const routerSrc = readFileSync(join(HANDLERS_DIR, 'message-router.ts'), 'utf8');
const messagesSrc = readFileSync('packages/shared/src/messages.ts', 'utf8');
const serverMsgSrc = readFileSync('packages/shared/src/server-messages.ts', 'utf8');
const clientMsgSrc = readFileSync('packages/shared/src/client-messages.ts', 'utf8');

// --- 1. Parse enum mappings ---

const clientKeyToWire = {};
const serverKeyToWire = {};
const serverBlock = messagesSrc.slice(0, messagesSrc.indexOf('} as const;'));
for (const m of serverBlock.matchAll(/(\w+):\s*'([^']+)'/g)) serverKeyToWire[m[1]] = m[2];
const clientBlock = messagesSrc.slice(messagesSrc.indexOf('ClientMsgType'));
for (const m of clientBlock.matchAll(/(\w+):\s*'([^']+)'/g)) clientKeyToWire[m[1]] = m[2];

const serverKeyToTypeName = {};
for (const m of serverMsgSrc.matchAll(/export\s+type\s+(\w+)\s*=\s*\{[^}]*typeof\s+ServerMsgType\.(\w+)/gs)) {
    serverKeyToTypeName[m[2]] = m[1];
}

// --- 2. Parse server router and handlers ---

const importMap = {};
for (const m of routerSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
    const file = m[2].replace('.js', '.ts');
    for (const fn of m[1].split(',').map(s => s.trim()).filter(Boolean)) importMap[fn] = file;
}

const handlerFiles = new Set(Object.values(importMap));
handlerFiles.add('message-router.ts');
const fnInfo = {};
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
        const serverKeys = new Set();
        for (const m of body.matchAll(/ServerMsgType\.(\w+)/g)) serverKeys.add(m[1]);
        const calls = new Set();
        for (const m of body.matchAll(/\b(handle\w+)\s*\(/g)) { if (m[1] !== fnStarts[i].name) calls.add(m[1]); }
        fnInfo[fnStarts[i].name] = { file, serverKeys, calls };
    }
}

function resolveServerKeys(fnName, visited = new Set()) {
    const info = fnInfo[fnName];
    if (!info) return new Set();
    visited.add(fnName);
    const keys = new Set(info.serverKeys);
    for (const callee of info.calls) {
        if (!visited.has(callee)) for (const k of resolveServerKeys(callee, visited)) keys.add(k);
    }
    return keys;
}

const dispatch = {};
let currentCases = [];
for (const line of routerSrc.split('\n')) {
    const caseMatch = line.match(/case\s+ClientMsgType\.(\w+)\s*:/);
    if (caseMatch) currentCases.push(caseMatch[1]);
    const handlerMatch = line.match(/return\s+(handle\w+)\s*\(/);
    const inlineMatch = line.match(/send\s*\(\s*ws\s*,\s*\{/);
    if ((handlerMatch || inlineMatch) && currentCases.length > 0) {
        const fn = handlerMatch ? handlerMatch[1] : null;
        const file = fn ? (importMap[fn] || 'message-router.ts') : 'message-router.ts';
        for (const key of currentCases) {
            const wire = clientKeyToWire[key];
            if (wire) dispatch[wire] = { fn, file };
        }
        currentCases = [];
    }
}

// --- 3. Client input mapping (manually maintained — derived from input.ts, input-combat.ts, input-misc.ts) ---
// Each entry: ClientMsgType key -> [{ mode, key }]
// key uses HTML entities for special chars: ⏎ = &#9166;, <> for placeholders
const S = '&lt;sector&gt;&#9166;';
const Q = '&lt;qty&gt;&#9166;';
const N = '&lt;#&gt;&#9166;';

const clientInputMap = {
    Move:                [{ mode: 'sector', key: S }, { mode: 'sector', key: `m ${S}` }, { mode: 'autopilotPrompt', key: 'y' }],
    SectorDisplay:       [{ mode: 'sector', key: 'd' }],
    Who:                 [{ mode: 'sector', key: '#' }],
    SectorWarps:         [],  // no client UI
    Path:                [{ mode: '(auto)', key: 'non-adjacent move' }],
    PortInfo:            [],  // no client UI
    ShipInfo:            [{ mode: 'sector', key: 'i (auto)' }],
    CargoInfo:           [{ mode: 'sector', key: 'i (auto)' }],
    PortTransaction:     [{ mode: 'docked', key: `b &lt;good&gt; ${Q}` }, { mode: 'docked', key: `s &lt;good&gt; ${Q}` }],
    BuyFighters:         [{ mode: 'class0Qty', key: Q }],
    BuyShields:          [{ mode: 'class0Qty', key: Q }],
    BuyHolds:            [{ mode: 'class0Qty', key: Q }],
    ShipExchange:        [],  // no client UI
    Attack:              [{ mode: 'attackFighters', key: Q }],
    Dock:                [{ mode: 'port', key: 't' }],
    Undock:              [{ mode: 'docked', key: 'q' }, { mode: 'class0', key: 'q' }],
    Jettison:            [{ mode: 'jettisonConfirm', key: 'y' }],
    Land:                [{ mode: 'sector', key: 'l' }],
    TakeColonists:       [{ mode: 'planetTakeQty', key: Q }],
    LeaveColonists:      [{ mode: 'planetLeaveQty', key: Q }],
    DeployFightersInfo:  [{ mode: 'sector', key: 'f' }],
    DeployFighters:      [{ mode: 'deployFightersQty', key: Q }],
    AttackSectorFighters:[{ mode: 'fighterAttackQty', key: Q }],
    RetreatFromFighters: [{ mode: 'fighterEncounter', key: 'r' }],
    UseTerraformDevice:  [],  // no client UI
    LandOnPlanet:        [],  // no client UI
    PlanetDisplay:       [],  // no client UI
    DestroyPlanet:       [],  // no client UI
    LeavePlanet:         [],  // no client UI
    BuyPlanetBusters:    [],  // no client UI
    BuyTerraformDevices: [],  // no client UI
    DockStardock:        [],  // no client UI
    LeaveStardock:       [],  // no client UI
};

// --- 4. Build the mapping table rows ---

const clientDefs = clientSchema.definitions ?? {};
const clientUnion = clientSchema.$ref?.replace('#/definitions/', '');
const clientMembers = (clientDefs[clientUnion]?.anyOf ?? [])
    .map(r => r.$ref?.replace('#/definitions/', '')).filter(Boolean);

const tableRows = [];
for (const typeName of clientMembers) {
    const def = clientDefs[typeName];
    const wire = def?.properties?.type?.const;
    if (!wire) continue;

    const d = dispatch[wire];
    const handlerFn = d?.fn || '(inline)';

    let serverKeys;
    if (d?.fn) {
        serverKeys = resolveServerKeys(d.fn);
    } else {
        serverKeys = new Set();
        const searchKey = Object.entries(clientKeyToWire).find(([, v]) => v === wire)?.[0];
        if (searchKey) {
            const inlineBlock = routerSrc.slice(routerSrc.indexOf(`ClientMsgType.${searchKey}`));
            const blockEnd = inlineBlock.indexOf('return;');
            const block = inlineBlock.slice(0, blockEnd > 0 ? blockEnd : 200);
            for (const m of block.matchAll(/ServerMsgType\.(\w+)/g)) serverKeys.add(m[1]);
        }
    }

    const primaryKeys = [...serverKeys].filter(k => k !== 'Error');
    const responseTypes = primaryKeys
        .map(k => ({ key: k, wire: serverKeyToWire[k], typeName: serverKeyToTypeName[k] }))
        .filter(r => r.typeName);

    // Find ClientMsgType key from wire
    const msgTypeKey = Object.entries(clientKeyToWire).find(([, v]) => v === wire)?.[0];
    const inputEntries = msgTypeKey ? (clientInputMap[msgTypeKey] || []) : [];

    tableRows.push({ clientTypeName: typeName, clientWire: wire, handlerFn, responseTypes, inputEntries });
}

// --- Rendering helpers ---

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
    const unionDef = defs[unionName];
    const unionMembers = new Set(
        (unionDef?.anyOf ?? []).map(ref => ref.$ref?.replace('#/definitions/', '')).filter(Boolean)
    );
    return Object.entries(defs)
        .filter(([name]) => unionMembers.has(name))
        .sort(([, a], [, b]) => (a.properties?.type?.const ?? '').localeCompare(b.properties?.type?.const ?? ''));
}

function renderSidebarTree(label, id, messages) {
    const items = messages.map(([name, def]) => {
        const wire = def.properties?.type?.const ?? '?';
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
    const wireType = def.properties?.type?.const ?? '?';
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
    const rows = tableRows.map(r => {
        const responses = r.responseTypes.length > 0
            ? r.responseTypes.map(rt => `<a href="#${rt.typeName}" class="response-link">${rt.typeName}</a>`).join(', ')
            : '<span class="dim">none</span>';
        const handler = r.handlerFn === '(inline)'
            ? '<span class="dim">inline</span>'
            : `<code class="fn">${r.handlerFn}</code>`;

        let menuCell, keyCell;
        if (r.inputEntries.length > 0) {
            menuCell = r.inputEntries.map(e => `<code class="mode">${e.mode}</code>`).join('<br>');
            keyCell = r.inputEntries.map(e => `<kbd>${e.key}</kbd>`).join('<br>');
        } else {
            menuCell = '<span class="dim">no UI</span>';
            keyCell = '<span class="dim">&mdash;</span>';
        }

        return `      <tr>
        <td>${menuCell}</td>
        <td>${keyCell}</td>
        <td><a href="#${r.clientTypeName}">${r.clientTypeName}</a></td>
        <td><code class="wire">${r.clientWire}</code></td>
        <td>${handler}</td>
        <td>${responses}</td>
      </tr>`;
    }).join('\n');

    return `<section class="group" id="mapping-section">
  <h2>Message Flow</h2>
  <p class="table-subtitle">User input &rarr; client message &rarr; handler &rarr; server response (excludes <code>ErrorMessage</code> which any handler can send)</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Menu</th><th>Key</th><th>Client Type</th><th>Wire</th><th>Handler</th><th>Server Response Types</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
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
  .main { margin-left: var(--sidebar-w); flex: 1; padding: 2rem 2.5rem; max-width: 1000px; }
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
