import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClientCommand, PortInfoResultObject } from '@twnr/shared';
import { MenuMode } from './constants.js';
import type { GameContext } from './types.js';
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

    let mode: MenuMode = MenuMode.Sector;
    let currentSector = 0;
    let currentPort: { class: number; name: string } | null = null;
    let dockedPortInfo: PortInfoResultObject | null = null;
    let visitedSet = new Set<number>();
    let playerName = '';
    let playerId = 0;
    let totalSectors = 0;
    let sectorPlayers: { id: number; name: string }[] = [];
    let attackTarget: number | null = null;
    let class0BuyType: 'fighters' | 'shields' | 'holds' | null = null;
    let shipConfigs: any[] | null = null;
    let planetConfigs: any[] | null = null;
    let currentShipName = '';
    let class0Prices: { fighterPrice: number; shieldPrice: number; holdPrice: number } | null =
        null;
    let autopilotPath: number[] = [];
    let autopilotStep = 0;
    let autopilotPaused = false;
    let encounterOwnerName = '';

    function sendMsg(msg: ClientCommand) {
        if (ws.readyState === WebSocket.OPEN) {
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
    };

    setupConnection(ws, ctx);
    setupInput(term, ctx);
}
