import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ClientMsgType } from '@twnr/shared';
import type { ClientCommand, PortInfoResultObject, MenuEntry, HardwarePrices } from '@twnr/shared';
import type { GameContext, TradeStep } from './types.js';
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

    let mode = 'sector';
    let currentSector = 0;
    let currentPort: { class: number; name: string } | null = null;
    let dockedPortInfo: PortInfoResultObject | null = null;
    let visitedSet = new Set<number>();
    let playerName = '';
    let playerId = 0;
    let totalSectors = 0;
    let sectorPlayers: { id: number; name: string }[] = [];
    let attackTarget: number | null = null;
    let class0BuyType: 'drones' | 'shields' | 'holds' | null = null;
    let shipConfigs: any[] | null = null;
    let planetConfigs: any[] | null = null;
    let currentShipName = '';
    let class0Prices: { dronePrice: number; shieldPrice: number; holdPrice: number } | null = null;
    let autopilotPath: number[] = [];
    let autopilotStep = 0;
    let autopilotPaused = false;
    let encounterOwnerName = '';
    let menuRegistry = new Map<string, MenuEntry>();
    let starbaseSector: number | null = null;
    let hardwarePrices: HardwarePrices | null = null;
    let colonistCommodity: 'fuel' | 'organics' | 'equipment' | null = null;
    let tradeQueue: TradeStep[] = [];
    let tradeStepIdx = 0;
    let tradePendingQty = 0;
    let tradeCredits = 0;
    let tradeEmptyHolds = 0;
    let tradeCargo = { fuel: 0, organics: 0, equipment: 0, colonists: 0 };
    let debug = false;

    function sendMsg(msg: ClientCommand) {
        if (ws.readyState === WebSocket.OPEN) {
            if (debug) {
                const lines = JSON.stringify(msg, null, 2).split('\n');
                term.writeln(`\r\n\x1b[38;5;243m→ ${lines[0]}\x1b[0m`);
                for (let i = 1; i < lines.length; i++) {
                    term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
                }
            }
            ws.send(JSON.stringify(msg));
        }
    }

    const ctx: GameContext = {
        term,
        ws,
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
        get playerName() {
            return playerName;
        },
        get playerId() {
            return playerId;
        },
        get totalSectors() {
            return totalSectors;
        },
        get sectorPlayers() {
            return sectorPlayers;
        },
        get attackTarget() {
            return attackTarget;
        },
        get class0BuyType() {
            return class0BuyType;
        },
        get shipConfigs() {
            return shipConfigs;
        },
        get planetConfigs() {
            return planetConfigs;
        },
        get currentShipName() {
            return currentShipName;
        },
        universeId,
        get class0Prices() {
            return class0Prices;
        },
        get autopilotPath() {
            return autopilotPath;
        },
        get autopilotStep() {
            return autopilotStep;
        },
        get autopilotPaused() {
            return autopilotPaused;
        },
        get encounterOwnerName() {
            return encounterOwnerName;
        },
        get debug() {
            return debug;
        },
        setDebug: (on) => {
            debug = on;
            term.writeln(`\r\n\x1b[38;5;243m[debug ${on ? 'ON' : 'OFF'}]\x1b[0m`);
        },
        sendMsg,
        setMode: (m) => {
            mode = m;
        },
        changeMenu: (m) => {
            mode = m;
            sendMsg({ type: ClientMsgType.ChangeMenu, menu: m });
        },
        setCurrentSector: (s) => {
            currentSector = s;
        },
        setCurrentPort: (p) => {
            currentPort = p;
        },
        setDockedPortInfo: (p) => {
            dockedPortInfo = p;
        },
        setPlayerName: (n) => {
            playerName = n;
        },
        setPlayerId: (id) => {
            playerId = id;
        },
        setTotalSectors: (n) => {
            totalSectors = n;
        },
        setSectorPlayers: (p) => {
            sectorPlayers = p;
        },
        setAttackTarget: (id) => {
            attackTarget = id;
        },
        setClass0BuyType: (t) => {
            class0BuyType = t;
        },
        setShipConfigs: (c) => {
            shipConfigs = c;
        },
        setPlanetConfigs: (c) => {
            planetConfigs = c;
        },
        setCurrentShipName: (n) => {
            currentShipName = n;
        },
        setClass0Prices: (p) => {
            class0Prices = p;
        },
        setAutopilotPath: (p) => {
            autopilotPath = p;
        },
        setAutopilotStep: (s) => {
            autopilotStep = s;
        },
        setAutopilotPaused: (p) => {
            autopilotPaused = p;
        },
        setEncounterOwnerName: (n) => {
            encounterOwnerName = n;
        },
        get menuRegistry() {
            return menuRegistry;
        },
        setMenuRegistry: (r) => {
            menuRegistry = r;
        },
        get starbaseSector() {
            return starbaseSector;
        },
        setStarbaseSector: (s) => {
            starbaseSector = s;
        },
        get hardwarePrices() {
            return hardwarePrices;
        },
        setHardwarePrices: (p) => {
            hardwarePrices = p;
        },
        get colonistCommodity() {
            return colonistCommodity;
        },
        setColonistCommodity: (c) => {
            colonistCommodity = c;
        },
        get tradeQueue() {
            return tradeQueue;
        },
        get tradeStep() {
            return tradeStepIdx;
        },
        get tradePendingQty() {
            return tradePendingQty;
        },
        get tradeCredits() {
            return tradeCredits;
        },
        get tradeEmptyHolds() {
            return tradeEmptyHolds;
        },
        get tradeCargo() {
            return tradeCargo;
        },
        setTradeQueue: (q) => {
            tradeQueue = q;
        },
        setTradeStep: (s) => {
            tradeStepIdx = s;
        },
        setTradePendingQty: (q) => {
            tradePendingQty = q;
        },
        setTradeCredits: (c) => {
            tradeCredits = c;
        },
        setTradeEmptyHolds: (h) => {
            tradeEmptyHolds = h;
        },
        setTradeCargo: (c) => {
            tradeCargo = c;
        },
    };

    // Fetch menu registry and cache for the session
    fetch('/api/menu-registry')
        .then((res) => res.json())
        .then((entries: MenuEntry[]) => {
            const map = new Map<string, MenuEntry>();
            for (const entry of entries) map.set(entry.name, entry);
            ctx.setMenuRegistry(map);
        })
        .catch((err) => console.error('Failed to fetch menu registry:', err));

    setupConnection(ws, ctx);
    setupInput(term, ctx);
}
