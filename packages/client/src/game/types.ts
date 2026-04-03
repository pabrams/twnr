import type { Terminal } from '@xterm/xterm';
import type { ClientMessage, PortInfoMessage } from '@twnr/shared';
import type { MenuMode } from './constants.js';
import { colors } from './constants.js';

export interface GameContext {
    term: Terminal;
    currentSector: number;
    currentPort: { class: number; name: string } | null;
    dockedPortInfo: PortInfoMessage | null;
    mode: MenuMode;
    visitedSet: Set<number>;
    playerName: string;
    playerId: number;
    totalSectors: number;
    sectorPlayers: { id: number; name: string }[];
    attackTarget: number | null;
    class0BuyType: 'fighters' | 'shields' | 'holds' | null;
    shipConfigs: any[] | null;
    planetConfigs: any[] | null;
    currentShipName: string;
    universeId: number;
    ws: WebSocket;
    sendMsg: (msg: ClientMessage) => void;
    setMode: (mode: MenuMode) => void;
    setCurrentSector: (sector: number) => void;
    setCurrentPort: (port: { class: number; name: string } | null) => void;
    setVisitedSet: (set: Set<number>) => void;
    setDockedPortInfo: (p: PortInfoMessage | null) => void;
    setPlayerName: (name: string) => void;
    setPlayerId: (id: number) => void;
    setTotalSectors: (n: number) => void;
    setSectorPlayers: (players: { id: number; name: string }[]) => void;
    setAttackTarget: (id: number | null) => void;
    setClass0BuyType: (t: 'fighters' | 'shields' | 'holds' | null) => void;
    setShipConfigs: (configs: any[]) => void;
    setPlanetConfigs: (configs: any[]) => void;
    setCurrentShipName: (name: string) => void;
    class0Prices: { fighterPrice: number; shieldPrice: number; holdPrice: number } | null;
    setClass0Prices: (p: { fighterPrice: number; shieldPrice: number; holdPrice: number }) => void;
    autopilotPath: number[];
    autopilotStep: number;
    autopilotPaused: boolean;
    encounterOwnerName: string;
    setAutopilotPath: (path: number[]) => void;
    setAutopilotStep: (step: number) => void;
    setAutopilotPaused: (paused: boolean) => void;
    setEncounterOwnerName: (name: string) => void;
}

const mg = colors.magenta;

export function colorSector(sector: number, visitedSet: Set<number>): string {
    const num = String(sector);
    if (visitedSet.has(sector)) return colors.boldCyan(num);
    return `${mg('(')}${colors.boldRed(num)}${mg(')')}`;
}
