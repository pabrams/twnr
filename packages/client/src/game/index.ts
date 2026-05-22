import { Terminal } from '@xterm/xterm';
import { ClientTag, Menu, globalConstants } from '@twnr/shared';
import type { ClientEnvelope, MenuEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { setupConnection } from './connection.js';
import { setupInput } from './input.js';
import { createMinimap, flashTerminalBorder } from './minimap.js';
import { createStatsPanel } from './stats-panel.js';
import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';
import { MENU_REGISTRY, MENU_PROMPTS } from './menu-registry.js';
import { registerMenu } from './routines/index.js';
import type { MenuName } from '@twnr/shared';

/**
 * Measure how many pixels one cell of a given fontFamily/lineHeight takes
 * per unit of fontSize. A hidden DOM probe with the same font settings xterm
 * renders with gives us the exact glyph advance and line box, so the refit
 * math is arithmetic against measured values instead of empirical guesses.
 * Linear in fontSize for monospace fonts, so one measurement at a reference
 * size scales to every other size.
 */
function measureFontMetrics(
    fontFamily: string,
    lineHeight: number,
): { widthPerSize: number; heightPerSize: number } {
    const REF_FONT_SIZE = 16;
    const SAMPLE_COLS = 80;
    const probe = document.createElement('span');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.style.fontFamily = fontFamily;
    probe.style.fontSize = `${REF_FONT_SIZE}px`;
    probe.style.lineHeight = String(lineHeight);
    probe.textContent = 'M'.repeat(SAMPLE_COLS);
    document.body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    document.body.removeChild(probe);
    return {
        widthPerSize: rect.width / SAMPLE_COLS / REF_FONT_SIZE,
        heightPerSize: rect.height / REF_FONT_SIZE,
    };
}

export function startGame(universeId: number, termDiv: HTMLElement, onDisconnect: () => void) {
    const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 17,
        lineHeight: 0.9,
        scrollback: 50000,
        cols: globalConstants.terminalCols,
        theme: {
            background: '#000000',
            foreground: '#ffffff',
        },
    });

    term.open(termDiv);

    // Pin logical width to globalConstants.terminalCols and scale fontSize to
    // whatever the container can hold. The two ratios (px per fontSize unit,
    // for cell width and height) are measured once from a hidden DOM probe
    // using the same font-family and lineHeight xterm renders with, so
    // they reflect the actual rendered glyph metrics rather than empirical
    // guesses.
    const MIN_FONT_SIZE = 6;
    const MAX_FONT_SIZE = 32;
    const { widthPerSize, heightPerSize } = measureFontMetrics(
        'Courier New, Courier, monospace',
        0.9,
    );
    function refit() {
        const style = window.getComputedStyle(termDiv);
        const padX =
            parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
        const padY =
            parseFloat(style.paddingTop || '0') + parseFloat(style.paddingBottom || '0');
        const w = termDiv.clientWidth - padX;
        const h = termDiv.clientHeight - padY;
        if (w <= 0 || h <= 0) return;
        const rawFontSize = Math.floor(w / globalConstants.terminalCols / widthPerSize);
        const fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, rawFontSize));
        const rows = Math.max(10, Math.floor(h / (fontSize * heightPerSize)));
        term.options.fontSize = fontSize;
        term.resize(globalConstants.terminalCols, rows);
    }
    refit();
    window.addEventListener('resize', refit);

    // Stop propagation at capture phase for Ctrl+wheel so xterm never sees it
    // and the browser handles it as a page zoom.
    termDiv.addEventListener(
        'wheel',
        (e) => {
            if (e.ctrlKey) e.stopPropagation();
        },
        { capture: true },
    );

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${location.host}/ws?universe=${universeId}`;

    // ctx.io.ws is mutated by reconnect(); sendMsg always reads the current
    // socket so messages route to the live connection.
    function sendMsg(msg: ClientEnvelope, opts?: { silent?: boolean }) {
        const sock = ctx.io.ws;
        if (sock.readyState !== WebSocket.OPEN) return;
        if (ctx.io.debug) {
            const lines = JSON.stringify(msg, null, 2).split('\n');
            term.writeln(`\r\n\x1b[38;5;243m→ ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }
        if (!opts?.silent) ctx.input.inFlight = true;
        sock.send(JSON.stringify(msg));
    }

    const ctx: GameContext = {
        io: {
            term,
            // Placeholder — replaced by openSocket() before any handler runs.
            ws: null as unknown as WebSocket,
            sendMsg,
            setDebug: (on) => {
                ctx.io.debug = on;
                term.writeln(`\r\n\x1b[38;5;243m[debug ${on ? 'ON' : 'OFF'}]\x1b[0m`);
            },
            debug: false,
            submitLineFromMap: () => {
                /* populated by setupInput */
            },
        },
        input: {
            userInputBuffer: [],
            inputQueue: [],
            inFlight: false,
            inputAssembly: '',
            pendingResolver: null,
            pendingResponse: null,
        },
        player: {
            universeId,
            name: '',
            id: 0,
            isAdmin: false,
            isGuest: false,
            clanId: null,
        },
        world: {
            mode: Menu.Sector,
            currentSector: 0,
            currentPort: null,
            currentPortConstruction: null,
            dockedPortInfo: null,
            visitedSet: new Set<number>(),
            totalSectors: 0,
            sectorPlayers: [],
            currentWarps: [],
            starbaseSector: null,
            earthColonists: 0,
            mineScanFilter: null,
        },
        ship: {
            currentShipName: '',
            currentColoredShipName: null,
            shipColonists: 0,
            planetEmptyHolds: 0,
            shipDrones: 0,
            shipMaxDrones: 0,
            shipFuel: 0,
            shipOrganics: 0,
            shipEquipment: 0,
        },
        planet: {
            fuel: 0,
            organics: 0,
            equipment: 0,
            drones: 0,
            maxFuel: 0,
            maxOrg: 0,
            maxEqu: 0,
            maxDrones: 0,
        },
        autopilot: {
            path: [],
            step: 0,
            paused: false,
        },
        encounter: {
            attackTarget: null,
            ownerName: '',
        },
        catalogs: {
            hardware: null,
            ships: null,
            planets: null,
            class0Prices: null,
            hardwarePrices: null,
            menus: new Map<string, MenuEntry>(),
        },
        starbase: {
            class0ShipState: null,
            hardwareStoreCredits: 0,
            hardwareStoreItems: [],
        },
        minimap: {},
        stats: {},
        pendingMenuArgs: null,
        connection: {
            disconnected: false,
            reconnect: () => {
                /* populated below */
            },
            leave: () => {
                /* populated below */
            },
        },
    };

    function onClose(info: { code: number; reason: string }): void {
        ctx.connection.disconnected = true;
        // Cancel any in-flight prompt or buffered input so the next reconnect
        // starts from a clean slate.
        if (ctx.input.pendingResolver) {
            const r = ctx.input.pendingResolver;
            ctx.input.pendingResolver = null;
            r.resolve(null);
        }
        if (ctx.input.pendingResponse) {
            const r = ctx.input.pendingResponse;
            ctx.input.pendingResponse = null;
            r.resolve(null);
        }
        ctx.input.userInputBuffer = [];
        ctx.input.inputQueue = [];
        ctx.input.inputAssembly = '';
        ctx.input.inFlight = false;
        if (ctx.player.isGuest) {
            term.writeln(render(NOTIFY.deletingGuest, { name: ctx.player.name }));
        }
        if (info.reason) {
            term.writeln(render(NOTIFY.connectionDropped, { reason: info.reason }));
        } else {
            term.writeln(render(NOTIFY.connectionDroppedNoReason));
        }
        term.writeln(render(ctx.player.isGuest ? NOTIFY.leavePrompt : NOTIFY.reconnectPrompt));
    }

    function openSocket(): void {
        ctx.connection.disconnected = false;
        const ws = new WebSocket(wsUrl);
        ctx.io.ws = ws;
        setupConnection(ws, ctx, onClose);
    }

    ctx.connection.reconnect = () => {
        term.writeln(render(NOTIFY.reconnecting));
        openSocket();
    };
    ctx.connection.leave = () => {
        term.dispose();
        termDiv.innerHTML = '';
        onDisconnect();
    };

    {
        const map = new Map<string, MenuEntry>();
        for (const entry of MENU_REGISTRY) map.set(entry.name, entry);
        ctx.catalogs.menus = map;
    }
    for (const [name, renderPrompt] of Object.entries(MENU_PROMPTS)) {
        registerMenu(name as MenuName, { renderPrompt });
    }

    const minimapEl = document.getElementById('minimap');
    if (minimapEl) {
        const minimap = createMinimap(minimapEl, (sectorNumber, currentSectorNumber) => {
            if (sectorNumber === currentSectorNumber || sectorNumber === ctx.world.currentSector) {
                ctx.io.submitLineFromMap('');
                return;
            }
            const isAdjacent = ctx.world.currentWarps.some((w) => w.sector === sectorNumber);
            if (!isAdjacent) {
                flashTerminalBorder(termDiv);
            }
            ctx.io.submitLineFromMap(String(sectorNumber));
        });
        ctx.minimap.handle = minimap;
        minimap.onRequestRefresh(() => {
            const vp = minimap.getViewport();
            ctx.io.sendMsg(
                {
                    type: ClientTag.GetNeighborhood,
                    halfWidthWorld: vp.halfWidthWorld,
                    halfHeightWorld: vp.halfHeightWorld,
                    centerXWorld: vp.centerXWorld,
                    centerYWorld: vp.centerYWorld,
                },
                { silent: true },
            );
        });
        // The minimap has no inputs that need keyboard focus, so push focus
        // back to the terminal after any click inside the panel.
        minimapEl.addEventListener('click', () => {
            term.focus();
        });
    }

    const statsEl = document.getElementById('stats');
    if (statsEl) {
        ctx.stats.handle = createStatsPanel(statsEl);
    }

    setupInput(term, ctx);
    openSocket();
}
