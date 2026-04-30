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
import { Menu } from '@twnr/shared';
import type { Minimap } from './minimap.js';

export type KeystrokeEvent = {
    key: string;
    isEnter: boolean;
    isBackspace: boolean;
};

export interface IO {
    term: Terminal;
    ws: WebSocket;
    sendMsg: (msg: ClientCommand) => void;
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
}

export interface PlayerState {
    universeId: number;
    name: string;
    id: number;
    /** Set by Welcome — admins get full-vision minimap with deeper depth options. */
    isAdmin: boolean;
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
    knownUniverseMode: 'explored' | 'unexplored';
}

/**
 * Args passed forward to the next menu after a server-roundtripped
 * ChangeMenu. Source menu sets via `setMenuArgs`; destination's
 * `renderPrompt`/`input` reads via `consumeMenuArgs`. Discriminated by
 * destination menu so each side's typing stays honest.
 */
export type MenuArgs =
    | { menu: typeof Menu.Class0Qty; kind: 'drones' | 'shields' | 'holds' }
    | { menu: typeof Menu.ShipyardsClass0Qty; kind: 'drones' | 'shields' | 'holds' }
    | {
          menu: typeof Menu.StarbaseBuyQty;
          itemName: string;
          defaultQty: number;
          label: string;
      }
    | {
          menu: typeof Menu.ShipyardsTradein;
          target: string;
          displayName: string;
          price: number;
          tradein: number;
      }
    | { menu: typeof Menu.PlanetTakeQty; commodity: 'fuel' | 'organics' | 'equipment' }
    | { menu: typeof Menu.PlanetLeaveQty; commodity: 'fuel' | 'organics' | 'equipment' }
    | {
          menu: typeof Menu.PlanetSelect;
          planets: { id: number; name: string; type: string }[];
      }
    | {
          menu: typeof Menu.AutopilotPrompt;
          path: { sector: number; visited: boolean }[];
          hops: number;
          turns: number;
      }
    | {
          menu: typeof Menu.TradeQty;
          commodity: string;
          action: 'buy' | 'sell';
          portTrading: number;
          onBoard: number;
          maxQty: number;
      }
    | {
          menu: typeof Menu.TradeConfirm;
          action: 'buy' | 'sell';
          totalPrice: number;
      }
    | {
          menu: typeof Menu.DeployDronesQty;
          minInSector: number;
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
}
