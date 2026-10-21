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
    /** True between WS close and reconnect; input intercepts Enter (reconnect) / Esc (leave) while set. */
    disconnected: boolean;
    /** Open a fresh WS to the same universe and rebind it onto this ctx. */
    reconnect: () => void;
    /** Dispose terminal and exit back to the universe-select screen. */
    leave: () => void;
}

export interface IO {
    term: Terminal;
    ws: WebSocket;
    /** `silent: true` skips setting inFlight — for fire-and-forget panel refreshes. */
    sendMsg: (msg: ClientEnvelope, opts?: { silent?: boolean }) => void;
    setDebug: (on: boolean) => void;
    debug: boolean;
    /** Submit a text line as if the user had typed it into the xterm. */
    submitLineFromMap: (line: string) => void;
    /** Inject a single key as if typed into the xterm. */
    submitKeyFromMap: (key: string) => void;
}

export interface InputLayer {
    /** Layer 1 — user keystrokes that arrived mid-roundtrip (only while inFlight).
     *  Drains before the burst queue; swallow-on-invalid: a stale key was a typo. */
    userInputBuffer: KeystrokeEvent[];
    /** Layer 2 — programmatic burst/script keys only (user keys bypass it).
     *  Drains after Layer 1; park-on-invalid so a burst stays coherent if the menu diverged. */
    inputQueue: KeystrokeEvent[];
    /** True while a server roundtrip is in flight; drain waits for it to clear. */
    inFlight: boolean;
    /** Layer 1 digit-assembly buffer, shared between direct keystrokes and queue drain. */
    inputAssembly: string;
    /** Set by ask* while a routine awaits input: the next input resolves here instead of
     *  menu dispatch ('line' assembles until Enter; 'char' resolves on the next keystroke).
     *  Cleared on resolve, cancel, and server menu changes. Single-slot — await prompts sequentially. */
    pendingResolver: {
        mode: 'line' | 'char';
        resolve: (input: string | null) => void;
    } | null;
    /** Set by awaitResponse: connection.ts resolves it on a matching envelope and suppresses
     *  that envelope's auto renderPrompt. Cleared on resolve, cancel, and server menu
     *  changes — routines must check for null after the await. */
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
    /** Which mine type the pending ListDeployedMines reply filters to; null = no scan in progress. */
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

/** Session caches: the universe catalogs are fetched lazily on first use; class0Prices arrives with DockResult / DockStarbaseResult. */
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

/** Args carried across a server-roundtripped ChangeMenu (setMenuArgs → consumeMenuArgs), discriminated by destination menu. */
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
