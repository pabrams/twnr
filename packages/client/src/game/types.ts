import type { Terminal } from '@xterm/xterm';
import type {
    ClientCommand,
    PortInfoResultObject,
    MenuEntry,
    HardwarePriceItem,
    ShipCatalogEntry,
    PlanetConfig,
} from '@twnr/shared';

export interface GameContext {
    // ─── Services (methods) ──────────────────────────────────────────
    term: Terminal;
    ws: WebSocket;
    universeId: number;
    sendMsg: (msg: ClientCommand) => void;
    /** Set mode locally AND notify server */
    changeMenu: (menu: string) => void;
    setDebug: (on: boolean) => void;

    // ─── Mutable state ───────────────────────────────────────────────
    mode: string;
    currentSector: number;
    currentPort: { class: number; name: string } | null;
    dockedPortInfo: PortInfoResultObject | null;
    visitedSet: Set<number>;
    playerName: string;
    playerId: number;
    totalSectors: number;
    sectorPlayers: { id: number; name: string }[];
    attackTarget: number | null;
    class0BuyType: 'drones' | 'shields' | 'holds' | null;
    shipConfigs: ShipCatalogEntry[] | null;
    planetConfigs: PlanetConfig[] | null;
    currentShipName: string;
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
    tradeQueue: TradeStep[];
    tradeStep: number;
    tradePendingQty: number;
    tradeCredits: number;
    tradeEmptyHolds: number;
    tradeCargo: { fuel: number; organics: number; equipment: number; colonists: number };

    // ─── Transient UI state (was ad-hoc via `as any`) ────────────────
    knownUniverseMode: 'explored' | 'unexplored';
    starbaseBuyItemName: string | null;
    shipyardsBuyTarget: string | null;
    landablePlanets: { id: number; name: string; type: string }[] | null;
}

export interface TradeStep {
    commodity: 'fuel' | 'organics' | 'equipment';
    commodityLabel: string;
    action: 'buy' | 'sell';
    maxQty: number;
    portTrading: number;
    onBoard: number;
    price: number;
}
