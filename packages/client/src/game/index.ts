import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClientMessage, PortInfoMessage } from '@twnr/shared';
import type { MenuMode } from './constants.js';
import type { GameContext } from './display.js';
import { setupConnection } from './connection.js';
import { setupInput } from './input.js';

export function startGame(universeId: number, termDiv: HTMLElement) {
    const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 14,
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

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProtocol}://${location.host}/ws?universe=${universeId}`);

    let mode: MenuMode = 'sector';
    let currentSector = 0;
    let currentPort: { class: number; name: string } | null = null;
    let dockedPortInfo: PortInfoMessage | null = null;
    let visitedSet = new Set<number>();

    function sendMsg(msg: ClientMessage) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    const ctx: GameContext = {
        term,
        get currentSector() {
            return currentSector;
        },
        get currentPort() {
            return currentPort;
        },
        get dockedPortInfo() {
            return dockedPortInfo;
        },
        get mode() {
            return mode;
        },
        get visitedSet() {
            return visitedSet;
        },
        sendMsg,
        setMode: (m) => {
            mode = m;
        },
        setCurrentSector: (s) => {
            currentSector = s;
        },
        setCurrentPort: (p) => {
            currentPort = p;
        },
        setVisitedSet: (s) => {
            visitedSet = s;
        },
        setDockedPortInfo: (p) => {
            dockedPortInfo = p;
        },
    };

    setupConnection(ws, ctx);
    setupInput(term, ctx);
}
