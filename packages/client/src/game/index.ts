import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClientMsgType, Menu } from '@twnr/shared';
import type { ClientCommand, MenuEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { setupConnection } from './connection.js';
import { setupInput } from './input.js';
import { COMMAND } from './messages/index.js';
import { render } from './renderer.js';
import { createMinimap, flashTerminalBorder } from './minimap.js';

export function startGame(universeId: number, termDiv: HTMLElement, onDisconnect: () => void) {
    const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 14,
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
    const ws = new WebSocket(`${wsProtocol}://${location.host}/ws?universe=${universeId}`);

    function sendMsg(msg: ClientCommand) {
        if (ws.readyState !== WebSocket.OPEN) return;

        // Echo command to the terminal (skip if no template exists for this type)
        const tpl = (COMMAND as Record<string, string | undefined>)[msg.type];
        if (tpl) {
            term.writeln(render(tpl, msg as unknown as Record<string, unknown>));
        }

        if (ctx.debug) {
            const lines = JSON.stringify(msg, null, 2).split('\n');
            term.writeln(`\r\n\x1b[38;5;243m→ ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }
        ws.send(JSON.stringify(msg));
    }

    const ctx: GameContext = {
        term,
        ws,
        universeId,
        sendMsg,
        changeMenu: (m) => {
            ctx.mode = m;
            sendMsg({ type: ClientMsgType.ChangeMenu, menu: m });
        },
        setDebug: (on) => {
            ctx.debug = on;
            term.writeln(`\r\n\x1b[38;5;243m[debug ${on ? 'ON' : 'OFF'}]\x1b[0m`);
        },

        mode: Menu.Sector,
        currentSector: 0,
        currentPort: null,
        dockedPortInfo: null,
        visitedSet: new Set<number>(),
        playerName: '',
        playerId: 0,
        totalSectors: 0,
        sectorPlayers: [],
        currentWarps: [],
        attackTarget: null,
        class0BuyType: null,
        class0ShipState: null,
        hardwareCatalog: null,
        shipConfigs: null,
        planetConfigs: null,
        currentShipName: '',
        currentColoredShipName: null,
        class0Prices: null,
        autopilotPath: [],
        autopilotStep: 0,
        autopilotPaused: false,
        encounterOwnerName: '',
        debug: false,
        menuRegistry: new Map<string, MenuEntry>(),
        starbaseSector: null,
        hardwarePrices: null,
        colonistCommodity: null,
        planetEmptyHolds: 0,
        shipColonists: 0,
        hardwareStoreCredits: 0,
        hardwareStoreItems: [],

        knownUniverseMode: 'explored',
        starbaseBuyItemName: null,
        starbaseBuyDefault: 0,
        shipyardsBuyTarget: null,
        landablePlanets: null,

        submitLineFromMap: () => {
            /* populated by setupInput */
        },
    };

    fetch('/api/menu-registry')
        .then((res) => res.json())
        .then((entries: MenuEntry[]) => {
            const map = new Map<string, MenuEntry>();
            for (const entry of entries) map.set(entry.name, entry);
            ctx.menuRegistry = map;
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
            if (sectorNumber === currentSectorNumber || sectorNumber === ctx.currentSector) {
                ctx.submitLineFromMap('');
                return;
            }
            const isAdjacent = ctx.currentWarps.some((w) => w.sector === sectorNumber);
            if (!isAdjacent) {
                flashTerminalBorder(termDiv);
            }
            ctx.submitLineFromMap(String(sectorNumber));
        });
        ctx.minimap = minimap;
        minimap.onRequestRefresh(() => {
            ctx.sendMsg({ type: ClientMsgType.GetNeighborhood, depth: minimap.getDepth() });
        });
        // The minimap has no inputs that need keyboard focus, so push focus
        // back to the terminal after any click inside the panel.
        minimapEl.addEventListener('click', () => {
            term.focus();
        });
    }

    setupConnection(ws, ctx, () => {
        term.dispose();
        termDiv.innerHTML = '';
        onDisconnect();
    });
    setupInput(term, ctx);
}
