import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClientMsgType, Menu } from '@twnr/shared';
import type { ClientCommand, MenuEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { setupConnection } from './connection.js';
import { setupInput } from './input.js';
import { createMinimap, flashTerminalBorder } from './minimap.js';
import { render } from './renderer.js';
import { NOTIFY } from './messages/index.js';

export function startGame(universeId: number, termDiv: HTMLElement, onDisconnect: () => void) {
    const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 17,
        scrollback: 50000,
        theme: {
            background: '#000000',
            foreground: '#ffffff',
        },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termDiv);
    fitAddon.fit();

    window.addEventListener('resize', () => fitAddon.fit());

    // xterm's viewport captures wheel events to scroll its scrollback buffer,
    // regardless of modifier keys. When the mouse is over the terminal that
    // eats the event before the browser sees Ctrl+wheel as a zoom gesture.
    // Stop propagation at capture phase for Ctrl+wheel so xterm never sees it
    // and the browser handles it as a page zoom (no preventDefault).
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
    function sendMsg(msg: ClientCommand, opts?: { silent?: boolean }) {
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
        },
        world: {
            mode: Menu.Sector,
            currentSector: 0,
            currentPort: null,
            dockedPortInfo: null,
            visitedSet: new Set<number>(),
            totalSectors: 0,
            sectorPlayers: [],
            currentWarps: [],
            starbaseSector: null,
            earthColonists: 0,
        },
        ship: {
            currentShipName: '',
            currentColoredShipName: null,
            shipColonists: 0,
            planetEmptyHolds: 0,
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
        minimap: {
            knownUniverseMode: 'explored',
        },
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

    function handleClose(info: { code: number; reason: string }): void {
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
        // Guest accounts are server-side deleted on WS close, so reconnecting
        // would just hit a "User not found" close. Surface that and skip the
        // reconnect option for guests.
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
        setupConnection(ws, ctx, handleClose);
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

    fetch('/api/menu-registry')
        .then((res) => res.json())
        .then((entries: MenuEntry[]) => {
            const map = new Map<string, MenuEntry>();
            for (const entry of entries) map.set(entry.name, entry);
            ctx.catalogs.menus = map;
        })
        .catch((err) => console.error('Failed to fetch menu registry:', err));

    // Mini-map setup. The mini-map lives in the adjacent #minimap panel and
    // uses the same xterm input pipeline for click-injection.
    const minimapEl = document.getElementById('minimap');
    if (minimapEl) {
        const minimap = createMinimap(minimapEl, (sectorNumber, currentSectorNumber) => {
            // If the clicked sector is the current sector, submit an empty line
            // (re-display). Otherwise: if the target isn't an outgoing
            // single-hop warp, flash the terminal border as a visual hint that
            // this will trigger autopilot rather than a direct move.
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
                    type: ClientMsgType.GetNeighborhood,
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

    setupInput(term, ctx);
    openSocket();
}
