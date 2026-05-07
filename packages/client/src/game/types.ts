import type { Terminal } from '@xterm/xterm';
import type {
    ClientCommand,
    MenuName,
    PortInfoResultObject,
    MenuEntry,
    HardwarePriceItem,
    HardwareStoreItem,
    ServerMessage,
    ShipCatalogEntry,
    PlanetConfig,
} from '@twnr/shared';
import { Menu } from '@twnr/shared';
import type { Minimap } from './minimap.js';

export type KeystrokeEvent = {
    key: string;
    isEnter: boolean;
    isBackspace: boolean;
};

export interface ConnectionState {
    /** True between WS close and successful reconnect. The input pipeline
     * intercepts Enter (reconnect) / Esc (leave universe) while this is set. */
    disconnected: boolean;
    /** Open a fresh WS to the same universe and rebind it onto this ctx. */
    reconnect: () => void;
    /** Dispose terminal and exit back to the universe-select screen. */
    leave: () => void;
}

export interface IO {
    term: Terminal;
    ws: WebSocket;
    /**
     * Send a client message. The optional `silent: true` form is for
     * fire-and-forget panel data refreshes (e.g. minimap GetNeighborhood)
     * that don't represent a state-changing user action — those don't toggle
     * `inFlight` (so keystrokes aren't buffered) and the response should
     * also skip the framework's prompt re-render via PROMPT_SUPPRESSING.
     */
    sendMsg: (msg: ClientCommand, opts?: { silent?: boolean }) => void;
    setDebug: (on: boolean) => void;
    debug: boolean;
    /** Submit a text line as if the user had typed it into the xterm (used by the mini-map). */
    submitLineFromMap: (line: string) => void;
}

export interface InputLayer {
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
    /**
     * Set by `askLine` / `askChar` / `askNumber` / `askConfirm` while a
     * client routine is awaiting user input mid-flow. When set, the input
     * pipeline routes the next input to `resolve` instead of dispatching
     * it to the menu's command registry. Two modes:
     *
     *   - `mode: 'line'`  — assemble characters until Enter, then resolve
     *     with the trimmed line (used by askLine/askNumber).
     *   - `mode: 'char'`  — resolve on the next keystroke without waiting
     *     for Enter (used by askChar/askConfirm for y/n style prompts).
     *
     * Cleared on resolve, on cancel, and on server-driven menu changes
     * (so a routine cannot leak past a menu transition). Single-slot —
     * routines must `await` each prompt sequentially.
     */
    pendingResolver: {
        mode: 'line' | 'char';
        resolve: (input: string | null) => void;
    } | null;
    /**
     * Set by `awaitResponse` while a client routine is awaiting a specific
     * server response after a roundtrip. Connection.ts resolves this when
     * a matching message arrives (and suppresses the auto renderPrompt for
     * that envelope so the routine owns the next prompt). Cleared on
     * resolve, on cancel, and on server-driven menu changes — routines
     * should always check for `null` after the await.
     */
    pendingResponse: {
        types: Set<string>;
        resolve: (msg: ServerMessage | null) => void;
    } | null;
}

export interface PlayerState {
    universeId: number;
    name: string;
    id: number;
    /** Set by Welcome — admins get full-vision minimap with deeper depth options. */
    isAdmin: boolean;
    /** Set by Welcome — guest accounts get deleted on WS close, so the
     * disconnect prompt skips the reconnect option. */
    isGuest: boolean;
}

export interface WorldState {
    mode: MenuName;
    currentSector: number;
    currentPort: { class: number; name: string } | null;
    dockedPortInfo: PortInfoResultObject | null;
    visitedSet: Set<number>;
    totalSectors: number;
    sectorPlayers: { id: number; name: string }[];
    currentWarps: { sector: number; visited: boolean }[];
    starbaseSector: number | null;
    earthColonists: number;
}

export interface ShipState {
    currentShipName: string;
    currentColoredShipName: string | null;
    shipColonists: number;
    planetEmptyHolds: number;
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

export interface Catalogs {
    hardware: { name: string; label: string; kind: 'stackable' | 'toggle' }[] | null;
    ships: ShipCatalogEntry[] | null;
    planets: PlanetConfig[] | null;
    class0Prices: { dronePrice: number; shieldPrice: number; holdPrice: number } | null;
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

/**
 * Args passed forward to the next menu after a server-roundtripped
 * ChangeMenu. Source menu sets via `setMenuArgs`; destination's
 * `renderPrompt`/`input` reads via `consumeMenuArgs`. Discriminated by
 * destination menu so each side's typing stays honest.
 */
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
    autopilot: AutopilotState;
    encounter: EncounterState;
    catalogs: Catalogs;
    starbase: StarbaseSession;
    minimap: MinimapView;
    pendingMenuArgs: MenuArgs | null;
    connection: ConnectionState;
}
