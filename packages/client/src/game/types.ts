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

export interface GameContext {
    term: Terminal;
    ws: WebSocket;
    universeId: number;
    sendMsg: (msg: ClientCommand) => void;
    changeMenu: (menu: MenuName) => void;
    setDebug: (on: boolean) => void;

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
    shipyardsBuyTarget: string | null;
    landablePlanets: { id: number; name: string; type: string }[] | null;
}
