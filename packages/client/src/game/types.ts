import type { Terminal } from '@xterm/xterm';
import type {
    ClientCommand,
    MenuName,
    PortInfoResultObject,
    MenuEntry,
    HardwarePriceItem,
    HardwareStoreItem,
    ShipCatalogEntry,
    PlanetConfig,
} from '@twnr/shared';
import type { Minimap } from './minimap.js';

export type KeystrokeEvent = {
    key: string;
    isEnter: boolean;
    isBackspace: boolean;
};

export interface GameContext {
    term: Terminal;
    ws: WebSocket;
    universeId: number;
    /** Send a client→server command. Pure network dispatch — UI echoes are
     *  the input handler's responsibility (see `echoCommand` in display.ts). */
    sendMsg: (msg: ClientCommand) => void;
    setDebug: (on: boolean) => void;

    /**
     * Layer 1 — user keystrokes that arrived during a server roundtrip.
     * Drains first (before the burst queue) and uses swallow-on-invalid: a
     * direct keystroke that's still wrong for the new menu was a user typo,
     * drop it. Empty in the steady state — keys only land here while inFlight
     * is true.
     */
    userInputBuffer: KeystrokeEvent[];
    /**
     * Layer 2 — the burst/script keystroke queue. Direct user keystrokes from
     * xterm bypass this entirely; only programmatic sources (burst commands,
     * future script engine) enqueue here. Drains after Layer 1 is empty and
     * uses park-on-invalid — a programmatic burst stays coherent even if the
     * menu state diverged, and the user unjams via the secondary prompt.
     */
    inputQueue: KeystrokeEvent[];
    /** True while a server roundtrip is in flight; drain waits for it to clear. */
    inFlight: boolean;
    /** Layer 1 digit-assembly buffer, shared between direct keystrokes and queue drain. */
    inputAssembly: string;

    mode: MenuName;
    currentSector: number;
    currentPort: { class: number; name: string } | null;
    dockedPortInfo: PortInfoResultObject | null;
    visitedSet: Set<number>;
    playerName: string;
    playerId: number;
    totalSectors: number;
    sectorPlayers: { id: number; name: string }[];
    currentWarps: { sector: number; visited: boolean }[];
    attackTarget: number | null;
    class0BuyType: 'drones' | 'shields' | 'holds' | null;
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
    hardwareCatalog: { name: string; label: string; kind: 'stackable' | 'toggle' }[] | null;
    shipConfigs: ShipCatalogEntry[] | null;
    planetConfigs: PlanetConfig[] | null;
    currentShipName: string;
    currentColoredShipName: string | null;
    class0Prices: { dronePrice: number; shieldPrice: number; holdPrice: number } | null;
    autopilotPath: number[];
    autopilotStep: number;
    autopilotPaused: boolean;
    encounterOwnerName: string;
    debug: boolean;
    menuRegistry: Map<string, MenuEntry>;
    starbaseSector: number | null;
    hardwarePrices: HardwarePriceItem[] | null;
    colonistCommodity: 'fuel' | 'organics' | 'equipment' | null;
    planetEmptyHolds: number;
    shipColonists: number;
    hardwareStoreCredits: number;
    hardwareStoreItems: HardwareStoreItem[];

    knownUniverseMode: 'explored' | 'unexplored';
    starbaseBuyItemName: string | null;
    starbaseBuyDefault: number;
    /** Label for the qty-prompt header, stashed for the MenuChanged dispatcher. */
    starbaseBuyLabel: string | null;
    shipyardsBuyTarget: string | null;
    /** Args stashed before transitioning to ShipyardsTradein, read by the dispatcher. */
    shipyardsBuyDisplayName: string | null;
    shipyardsBuyPrice: number;
    shipyardsBuyTradein: number;
    landablePlanets: { id: number; name: string; type: string }[] | null;
    minimap?: Minimap;
    /** Submit a text line as if the user had typed it into the xterm (used by the mini-map). */
    submitLineFromMap: (line: string) => void;
}
