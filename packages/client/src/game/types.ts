import type { Terminal } from '@xterm/xterm';
import type { ClientCommand, PortInfoResultObject, MenuEntry } from '@twnr/shared';
import { colors } from './constants.js';

export interface GameContext {
    term: Terminal;
    currentSector: number;
    currentPort: { class: number; name: string } | null;
    dockedPortInfo: PortInfoResultObject | null;
    mode: string;
    visitedSet: Set<number>;
    playerName: string;
    playerId: number;
    totalSectors: number;
    sectorPlayers: { id: number; name: string }[];
    attackTarget: number | null;
    class0BuyType: 'drones' | 'shields' | 'holds' | null;
    shipConfigs: any[] | null;
    planetConfigs: any[] | null;
    currentShipName: string;
    universeId: number;
    ws: WebSocket;
    debug: boolean;
    setDebug: (on: boolean) => void;
    sendMsg: (msg: ClientCommand) => void;
    setMode: (mode: string) => void;
    /** Optimistically set mode locally AND notify server */
    changeMenu: (menu: string) => void;
    setCurrentSector: (sector: number) => void;
    setCurrentPort: (port: { class: number; name: string } | null) => void;
    setDockedPortInfo: (p: PortInfoResultObject | null) => void;
    setPlayerName: (name: string) => void;
    setPlayerId: (id: number) => void;
    setTotalSectors: (n: number) => void;
    setSectorPlayers: (players: { id: number; name: string }[]) => void;
    setAttackTarget: (id: number | null) => void;
    setClass0BuyType: (t: 'drones' | 'shields' | 'holds' | null) => void;
    setShipConfigs: (configs: any[]) => void;
    setPlanetConfigs: (configs: any[]) => void;
    setCurrentShipName: (name: string) => void;
    class0Prices: { dronePrice: number; shieldPrice: number; holdPrice: number } | null;
    setClass0Prices: (p: { dronePrice: number; shieldPrice: number; holdPrice: number }) => void;
    autopilotPath: number[];
    autopilotStep: number;
    autopilotPaused: boolean;
    encounterOwnerName: string;
    setAutopilotPath: (path: number[]) => void;
    setAutopilotStep: (step: number) => void;
    setAutopilotPaused: (paused: boolean) => void;
    setEncounterOwnerName: (name: string) => void;
    menuRegistry: Map<string, MenuEntry>;
    setMenuRegistry: (registry: Map<string, MenuEntry>) => void;
}

