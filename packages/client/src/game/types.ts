import type { Terminal } from '@xterm/xterm';
import type {
    ClientEnvelope,
    MenuName,
    PortInfoReply,
    MenuEntry,
    Class0PriceList,
    HardwareCatalogItem,
    HardwarePriceItem,
    HardwareStoreItem,
    ServerEnvelope,
    ShipCatalogEntry,
    PlanetCatalogEntry,
} from '@twnr/shared';
import { Menu } from '@twnr/shared';
import type { Minimap } from './minimap.js';
import type { StatsPanel } from './stats-panel.js';

export type KeystrokeEvent = {
    key: string;
    isEnter: boolean;
    isBackspace: boolean;
};

export interface ConnectionState {
    disconnected: boolean;
    reconnect: () => void;
    exitToUniverseSelect: () => void;
}

export interface IO {
    term: Terminal;
    ws: WebSocket;
    sendMsg: (msg: ClientEnvelope, opts?: { silent?: boolean }) => void;
    setDebug: (on: boolean) => void;
    debug: boolean;
    submitLineFromMap: (line: string) => void;
    submitKeyFromMap: (key: string) => void;
}

export interface InputLayer {
    /** User keystrokes that arrived mid-roundtrip; drains before inputQueue, invalid keys swallowed (a stale key was a typo). */
    userInputBuffer: KeystrokeEvent[];
    /** Programmatic burst keys only; drains after userInputBuffer, invalid keys parked so a burst stays coherent. */
    inputQueue: KeystrokeEvent[];
    inFlight: boolean;
    inputAssembly: string;
    /** Single-slot ask* resolver — the next input resolves here instead of menu dispatch; cleared on resolve, cancel, and server menu changes. */
    pendingResolver: {
        mode: 'line' | 'char';
        resolve: (input: string | null) => void;
    } | null;
    /** Resolved on a matching envelope, suppressing that envelope's auto renderPrompt; nulled on cancel and server menu changes — check after awaiting. */
    pendingResponse: {
        types: Set<string>;
        resolve: (msg: ServerEnvelope | null) => void;
    } | null;
}

export interface PlayerState {
    universeId: number;
    name: string;
    id: number;
    isAdmin: boolean;
    isGuest: boolean;
    clanId: number | null;
}

export interface WorldState {
    mode: MenuName;
    currentSector: number;
    currentPort: { class: number; name: string } | null;
    currentPortConstruction: { class: number; name: string; daysLeft: number } | null;
    dockedPortInfo: PortInfoReply | null;
    visitedSet: Set<number>;
    totalSectors: number;
    sectorPlayers: { id: number; name: string }[];
    currentWarps: { sector: number; visited: boolean }[];
    starbaseSector: number | null;
    earthColonists: number;
    mineScanFilter: 'proximity' | 'seeker' | null;
}

export interface ShipState {
    currentShipName: string;
    currentColoredShipName: string | null;
    shipColonists: number;
    planetEmptyHolds: number;
    shipDrones: number;
    shipMaxDrones: number;
    shipMaxDroneAttack: number;
    shipFuel: number;
    shipOrganics: number;
    shipEquipment: number;
}

export interface PlanetState {
    fuel: number;
    organics: number;
    equipment: number;
    drones: number;
    maxFuel: number;
    maxOrg: number;
    maxEqu: number;
    maxDrones: number;
}

export interface AutopilotState {
    path: number[];
    step: number;
    paused: boolean;
}

export interface EncounterState {
    attackTarget: number | null;
    ownerName: string;
}

/** Lazily fetched session caches; class0Prices instead arrives with DockResult / DockStarbaseResult. */
export interface Catalogs {
    hardware: HardwareCatalogItem[] | null;
    ships: ShipCatalogEntry[] | null;
    planets: PlanetCatalogEntry[] | null;
    class0Prices: Class0PriceList | null;
    hardwarePrices: HardwarePriceItem[] | null;
    menus: Map<string, MenuEntry>;
}

export interface StarbaseSession {
    class0ShipState: {
        shipName: string;
        credits: number;
        drones: number;
        maxDrones: number;
        shields: number;
        maxShields: number;
        holds: number;
        maxHolds: number;
    } | null;
    hardwareStoreCredits: number;
    hardwareStoreItems: HardwareStoreItem[];
}

export interface MinimapView {
    handle?: Minimap;
}

export interface StatsView {
    handle?: StatsPanel;
}

/** Args carried across a server ChangeMenu roundtrip. */
export type MenuArgs = {
    menu: typeof Menu.AutopilotPrompt;
    path: { sector: number; visited: boolean }[];
    hops: number;
    turns: number;
};

export interface GameContext {
    io: IO;
    input: InputLayer;
    player: PlayerState;
    world: WorldState;
    ship: ShipState;
    planet: PlanetState;
    autopilot: AutopilotState;
    encounter: EncounterState;
    catalogs: Catalogs;
    starbase: StarbaseSession;
    minimap: MinimapView;
    stats: StatsView;
    pendingMenuArgs: MenuArgs | null;
    connection: ConnectionState;
}
