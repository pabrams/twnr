// WebSocket messages (server → client)

import { ServerMsgType, type MenuName } from './messages.js';

/** A sector number with player-specific visited flag. */
export type SectorRef = {
    sector: number;
    visited: boolean;
};

export type WelcomeEvent = {
    type: typeof ServerMsgType.Welcome;
    playerId: number;
    name: string;
    sector: number;
    token: string;
    totalSectors: number;
    shipName: string;
    coloredShipName: string | null;
    starbaseSector: number | null;
    /** Guest/demo account — UI shows a warning that the account is ephemeral. */
    isGuest: boolean;
    /** Admin account — client unlocks admin-mode minimap (full vision, deeper depths). */
    isAdmin: boolean;
};

export type PlayerMovedEvent = {
    type: typeof ServerMsgType.PlayerMoved;
    playerId: number;
    playerName: string;
    sector: number;
    direction: 'in' | 'out';
};

export type SectorDroneInfo = {
    quantity: number;
    ownerId: number | null;
    ownerName: string;
};

export type CollisionInfo = {
    planetName: string;
    collidingWithName: string;
    collisionAt: string;
};

export type SectorDisplayData = {
    sector: number;
    players: { id: number; name: string }[];
    warps: SectorRef[];
    port?: { class: number; name: string } | null;
    sectorDrones?: SectorDroneInfo | null;
    planets: { id: number; name: string; type: string }[];
    ships?: { id: number; name: string; typeName: string; ownerName: string }[];
    collisions?: CollisionInfo[];
};

export type SectorDisplayResultObject = {
    type: typeof ServerMsgType.SectorDisplayResult;
} & SectorDisplayData;

export type MoveResultObject =
    | ({
          type: typeof ServerMsgType.MoveResult;
          outcome: 'success';
          turnsUsed?: number;
      } & SectorDisplayData)
    | {
          type: typeof ServerMsgType.MoveResult;
          outcome: 'encounter';
          sector: number;
          warps: SectorRef[];
          players: { id: number; name: string }[];
          port?: { class: number; name: string } | null;
          sectorDrones: number;
          ownerId: number | null;
          ownerName: string;
          shipDrones: number;
          retreatSector: number;
          turnsUsed?: number;
      }
    | { type: typeof ServerMsgType.MoveResult; outcome: 'nonAdjacent'; sector: number }
    | { type: typeof ServerMsgType.MoveResult; outcome: 'noShip' }
    | { type: typeof ServerMsgType.MoveResult; outcome: 'error'; message: string };

export type PlayerLeftEvent = {
    type: typeof ServerMsgType.PlayerLeft;
    playerId: number;
};

export type PlayersOnlineResultObject = {
    type: typeof ServerMsgType.PlayersOnlineResult;
    players: { id: number; name: string }[];
};

export type NoShipResultObject = {
    type: typeof ServerMsgType.NoShip;
};

export type NonAdjacentMoveResultObject = {
    type: typeof ServerMsgType.NonAdjacentMoveRequested;
    playerId: number;
    sector: number;
};

export type RateLimitedEvent = {
    type: typeof ServerMsgType.RateLimited;
};

export type WarpsOutResultObject = {
    type: typeof ServerMsgType.WarpsOutResult;
    id: number;
    warps: SectorRef[];
};

export type ShortestPathResultObject = {
    type: typeof ServerMsgType.ShortestPathResult;
    path: SectorRef[];
    hops: number;
    turns: number;
};

export type PortInfoResultObject = {
    type: typeof ServerMsgType.PortInfoResult;
    sectorId: number;
    portName: string;
    class: number;
    fuel: number;
    fuelMax: number;
    fuelPrice: number;
    organics: number;
    orgMax: number;
    orgPrice: number;
    equipment: number;
    equMax: number;
    equPrice: number;
};

export type ShipInfoResultObject = {
    type: typeof ServerMsgType.ShipInfoResult;
    playerId: number;
    shipName: string;
    coloredShipName: string | null;
    drones: number;
    shields: number;
    maxDrones: number;
    maxShields: number;
    cargoLimit: number;
    maxHolds: number;
    cargoFuel: number;
    cargoOrganics: number;
    cargoEquipment: number;
    cargoColonists: number;
    holdsAvailable: number;
    hardware: Record<string, number>;
    hardwareMax: Record<string, number>;
    turnsPerWarp: number;
    hasHyperwarpDrive: boolean;
    turns: number;
    credits: number;
};

export type PortTransactionResultObject = {
    type: typeof ServerMsgType.PortTransactionResult;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number; colonists: number };
    emptyHolds: number;
    turnsUsed?: number;
};

export type BuyDronesResultObject = {
    type: typeof ServerMsgType.BuyDronesResult;
    credits: number;
    drones: number;
};

export type BuyShieldsResultObject = {
    type: typeof ServerMsgType.BuyShieldsResult;
    credits: number;
    shields: number;
};

export type BuyHoldsResultObject = {
    type: typeof ServerMsgType.BuyHoldsResult;
    credits: number;
    cargoLimit: number;
    turnsUsed?: number;
};

export type BuyShipTradeinResultObject = {
    type: typeof ServerMsgType.BuyShipTradeinResult;
    shipName: string;
    coloredShipName: string | null;
    credits: number;
    maxDrones: number;
    maxShields: number;
    cargoLimit: number;
};

export type AttackShipResultObject = {
    type: typeof ServerMsgType.AttackShipResult;
    destroyed: boolean;
    attackerDronesLost: number;
    defenderShieldsLost: number;
    defenderDronesLost: number;
    message?: string;
};

export type DockResultObject = {
    type: typeof ServerMsgType.DockResult;
    docked: boolean;
    port?: PortInfoResultObject;
    credits?: number;
    cargo?: { fuel: number; organics: number; equipment: number; colonists: number };
    emptyHolds?: number;
    /** Included when docking at a Class-0 port — drives the Commerce report UI. */
    shipInfo?: {
        shipName: string;
        drones: number;
        maxDrones: number;
        shields: number;
        maxShields: number;
        holds: number;
        maxHolds: number;
    };
};

export type PlanetInfoResultObject = {
    type: typeof ServerMsgType.PlanetInfoResult;
    sectorId: number;
    name: string;
    planetType: string;
    colonists: number;
    hasPlanet: boolean;
};

export type UseTerraformDeviceResultObject = {
    type: typeof ServerMsgType.UseTerraformDeviceResult;
    success: boolean;
    reason?: string;
    planet?: { id: number; name: string; type: string; sectorId: number };
    collision?: boolean;
    terraformDevices?: number;
};

export type LandResultObject = {
    type: typeof ServerMsgType.LandResult;
    planets: { id: number; name: string; type: string }[];
};

export type PlanetDisplayData = {
    id: number;
    sector_id: number;
    name: string;
    planetType: string;
    drones: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    empty_holds: number;
    ship_colonists: number;
    created_at: Date | string;
    updated_at?: Date | string | null;
};

export type LandOnPlanetResultObject = {
    type: typeof ServerMsgType.LandOnPlanetResult;
} & PlanetDisplayData;

export type PlanetDisplayResultObject = {
    type: typeof ServerMsgType.PlanetDisplayResult;
} & PlanetDisplayData;

export type DestroyPlanetResultObject = {
    type: typeof ServerMsgType.DestroyPlanetResult;
    destroyed: boolean;
    planetId: number;
    planetName: string;
};

export type BuyHardwareResultObject = {
    type: typeof ServerMsgType.BuyHardwareResult;
    itemName: string;
    label: string;
    kind: 'stackable' | 'toggle';
    quantity?: number;
    totalOnShip?: number;
    /** Credits remaining after the purchase. */
    credits: number;
    /** Credits spent on this purchase (qty * unitPrice for stackable, unitPrice for toggle). */
    cost: number;
};

export type HardwarePriceItem = {
    name: string;
    label: string;
    price: number;
};

export type DockStarbaseResultObject = {
    type: typeof ServerMsgType.DockStarbaseResult;
    prices: HardwarePriceItem[];
    credits?: number;
    shipInfo?: {
        shipName: string;
        drones: number;
        maxDrones: number;
        shields: number;
        maxShields: number;
        holds: number;
        maxHolds: number;
    };
};

/**
 * Take colonists. On Earth this auto-lifts (one-shot interaction) and
 * the result envelope includes the sector display data inline. On real
 * planets the player stays on-planet; the sector fields are absent.
 * Symmetric with LeaveColonistsResultObject.
 */
export type TakeColonistsResultObject = {
    type: typeof ServerMsgType.TakeColonistsResult;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment';
    planetColonists: number;
    shipColonists: number;
} & Partial<SectorDisplayData>;

export type LeaveColonistsResultObject = {
    type: typeof ServerMsgType.LeaveColonistsResult;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment';
    planetColonists: number;
    shipColonists: number;
} & Partial<SectorDisplayData>;

// DroneEncounter embeds full sector display data (Oak's design) to avoid message ordering issues
export type DroneEncounterResultObject = {
    type: typeof ServerMsgType.DroneEncounter;
    sector: number;
    warps: SectorRef[];
    players: { id: number; name: string }[];
    port?: { class: number; name: string } | null;
    sectorDrones: number;
    ownerId: number | null;
    ownerName: string;
    shipDrones: number;
    retreatSector: number;
};

export type DeployDronesInfoResultObject = {
    type: typeof ServerMsgType.DeployDronesInfoResult;
    sectorDrones: number;
    shipDrones: number;
    shipMaxDrones: number;
};

export type DeployDronesResultObject = {
    type: typeof ServerMsgType.DeployDronesResult;
    sectorDrones: number;
    shipDrones: number;
};

export type AttackSectorDronesResultObject = {
    type: typeof ServerMsgType.AttackSectorDronesResult;
    victory: boolean;
    dronesLost: number;
    sectorDronesRemaining: number;
    shipDrones: number;
};

export type RetreatFromDronesResultObject = {
    type: typeof ServerMsgType.RetreatFromDronesResult;
    sector: number;
};

export type SectorDronesAlertEvent = {
    type: typeof ServerMsgType.SectorDronesAlert;
    event: 'intrusion' | 'attacked' | 'destroyed';
    sector: number;
    dronesLost: number;
    dronesRemaining: number;
    intruderName: string;
};

export type JettisonResultObject =
    | {
          type: typeof ServerMsgType.JettisonResult;
          outcome: 'success';
          jettisoned: { fuel: number; organics: number; equipment: number; colonists: number };
      }
    | { type: typeof ServerMsgType.JettisonResult; outcome: 'error'; message: string };

export type UndockResultObject =
    | ({
          type: typeof ServerMsgType.UndockResult;
          outcome: 'success';
          /** When the dock immediately bounced (e.g. nothing to trade), the
           * noTrade-style message rides along on the same envelope so the
           * client doesn't render an intermediate Port prompt. */
          tradeSkipReason?: TradeSkipReason;
      } & SectorDisplayData)
    | { type: typeof ServerMsgType.UndockResult; outcome: 'error'; message: string };

export type LeavePlanetResultObject = {
    type: typeof ServerMsgType.LeavePlanetResult;
    turnsUsed?: number;
} & SectorDisplayData;

export type LeaveStarbaseResultObject = {
    type: typeof ServerMsgType.LeaveStarbaseResult;
} & SectorDisplayData;

export type BuyShipNewResultObject = {
    type: typeof ServerMsgType.BuyShipNewResult;
    shipName: string;
    coloredShipName: string | null;
    credits: number;
    maxDrones: number;
    maxShields: number;
    cargoLimit: number;
};

export type ListDeployedDronesResultObject = {
    type: typeof ServerMsgType.ListDeployedDronesResult;
    drones: { sectorId: number; quantity: number }[];
};

export type HyperspaceJumpResultObject = {
    type: typeof ServerMsgType.HyperspaceJumpResult;
    targetSector: number;
    fuelUsed: number;
    turnsUsed: number;
};

export type ErrorResultObject = {
    type: typeof ServerMsgType.Error;
    message: string;
};

export type VisitedSectorsResultObject = {
    type: typeof ServerMsgType.VisitedSectorsResult;
    sectors: number[];
    totalSectors: number;
};

export type ListPlanetsResultObject = {
    type: typeof ServerMsgType.ListPlanetsResult;
    planets: {
        id: number;
        sectorNumber: number;
        name: string;
        type: string;
        fuel: number;
        organics: number;
        equipment: number;
        colonists_fuel: number;
        colonists_organics: number;
        colonists_equipment: number;
    }[];
};

// Server-driven trade flow
export type TradePromptObject = {
    type: typeof ServerMsgType.TradePrompt;
    commodity: string;
    commodityLabel: string;
    action: 'buy' | 'sell';
    portTrading: number;
    onBoard: number;
    maxQty: number;
    price: number;
    credits: number;
    emptyHolds: number;
};

export type TradeConfirmPromptObject = {
    type: typeof ServerMsgType.TradeConfirmPrompt;
    commodity: string;
    commodityLabel: string;
    action: 'buy' | 'sell';
    quantity: number;
    totalPrice: number;
};

export type TradeCompleteObject = {
    type: typeof ServerMsgType.TradeComplete;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number; colonists: number };
    emptyHolds: number;
    turnsUsed?: number;
};

export type TradeSkipReason =
    | 'noTrade'
    | 'insufficientTurns'
    | 'insufficientCredits'
    | 'insufficientPortInventory'
    | 'insufficientCargoHolds'
    | 'insufficientCargo'
    | 'portCannotBuy';

export type TradeSkippedObject = {
    type: typeof ServerMsgType.TradeSkipped;
    reason: TradeSkipReason;
};

export type PreviousSectorResultObject = {
    type: typeof ServerMsgType.PreviousSectorResult;
    sector: number | null;
};

export type AttackMenuResultObject = {
    type: typeof ServerMsgType.AttackMenuResult;
    players: { id: number; name: string }[];
};

export type StarbaseInfoResultObject = {
    type: typeof ServerMsgType.StarbaseInfoResult;
    sector: number | null;
    universeName: string;
    sectorCount: number;
    portCount: number;
    createdAt: string; // ISO8601
    daysElapsed: number;
    /** Out-warp degree distribution: index = degree (0..6), value = sector count. */
    outWarpDistribution: number[];
    maxPlanetsPerSector: number;
    startingCredits: number;
    startingTurns: number;
    startingDrones: number;
    startingHolds: number;
    /** Cool-down between ship destruction and being able to log back in. */
    respawnDelaySeconds: number;
};

export type TerraformInfoResultObject = {
    type: typeof ServerMsgType.TerraformInfoResult;
    canTerraform: boolean;
    devices: number;
    reason?: 'restricted_sector' | 'no_devices';
};

export type HardwareStoreItem = {
    name: string;
    label: string;
    kind: 'stackable' | 'toggle';
    price: number;
    currentQty: number;
    maxQty: number;
};

export type HardwareStoreInfoResultObject = {
    type: typeof ServerMsgType.HardwareStoreInfoResult;
    credits: number;
    items: HardwareStoreItem[];
};

export type NeighborhoodSector = {
    id: number;
    sector_number: number;
    x: number | null;
    y: number | null;
    visibility: 'visited' | 'glimpsed';
    /**
     * Fringe sectors show only the warps, not the sectors on the other ends.
     */
    fringe: boolean;
    port: { class: number; observed_at: string } | null;
    planets: Array<{ name: string; type: string | null; observed_at: string }>;
};

export type NeighborhoodWarp = {
    from_sector_id: number;
    to_sector_id: number;
    known_two_way: boolean;
};

export type DeployMineResultObject = {
    type: typeof ServerMsgType.DeployMineResult;
    mineType: 'proximity' | 'seeker';
    deployed: number;
    sectorTotal: number;
    shipRemaining: number;
};

export type DeployedMineEntry = {
    sectorNumber: number;
    mineType: 'proximity' | 'seeker';
    quantity: number;
};

export type ListDeployedMinesResultObject = {
    type: typeof ServerMsgType.ListDeployedMinesResult;
    mines: DeployedMineEntry[];
};

export type TrackedSeekerMineEntry = {
    targetShipId: number;
    targetShipName: string;
    targetOwnerName: string;
    sectorNumber: number;
};

export type TrackSeekerMinesResultObject = {
    type: typeof ServerMsgType.TrackSeekerMinesResult;
    targets: TrackedSeekerMineEntry[];
};

export type MineDisruptorResultObject = {
    type: typeof ServerMsgType.MineDisruptorResult;
    targetSector: number;
    minesDisrupted: number;
    proximityMinesRemaining: number;
};

export type ProximityMineHitEvent = {
    type: typeof ServerMsgType.ProximityMineHit;
    sector: number;
    detonations: number;
    damage: number;
    shieldsLost: number;
    dronesLost: number;
    destroyed: boolean;
};

export type SeekerMineAttachedEvent = {
    type: typeof ServerMsgType.SeekerMineAttached;
    sector: number;
    droppedPrevious: boolean;
};

export type SeekerMinePickupAlertEvent = {
    type: typeof ServerMsgType.SeekerMinePickupAlert;
    sector: number;
    targetShipName: string;
    targetOwnerName: string;
};

export type NeighborhoodResultObject = {
    type: typeof ServerMsgType.NeighborhoodResult;
    topology: 'random' | 'proximal';
    current_sector_id: number;
    sectors: NeighborhoodSector[];
    warps: NeighborhoodWarp[];
};

/**
 * Discriminated union of server-built result payloads — the type a handler
 * returns. Has no `menu` field; the messaging layer adds `menu` at send
 * time. The wire type — what the client receives — is `ServerMessage`,
 * which extends every variant with `menu` and adds a `MenuTransition`
 * variant for pure transitions that carry no other data.
 */
export type ServerResult =
    | WelcomeEvent
    | PlayerMovedEvent
    | SectorDisplayResultObject
    | MoveResultObject
    | UndockResultObject
    | JettisonResultObject
    | LeavePlanetResultObject
    | LeaveStarbaseResultObject
    | PlayerLeftEvent
    | PlayersOnlineResultObject
    | NoShipResultObject
    | NonAdjacentMoveResultObject
    | RateLimitedEvent
    | WarpsOutResultObject
    | ShortestPathResultObject
    | PortInfoResultObject
    | ShipInfoResultObject
    | PortTransactionResultObject
    | BuyDronesResultObject
    | BuyShieldsResultObject
    | BuyHoldsResultObject
    | BuyShipTradeinResultObject
    | AttackShipResultObject
    | DockResultObject
    | PlanetInfoResultObject
    | TakeColonistsResultObject
    | LeaveColonistsResultObject
    | DroneEncounterResultObject
    | DeployDronesInfoResultObject
    | DeployDronesResultObject
    | AttackSectorDronesResultObject
    | RetreatFromDronesResultObject
    | SectorDronesAlertEvent
    | UseTerraformDeviceResultObject
    | LandResultObject
    | LandOnPlanetResultObject
    | PlanetDisplayResultObject
    | DestroyPlanetResultObject
    | BuyHardwareResultObject
    | DockStarbaseResultObject
    | BuyShipNewResultObject
    | ListDeployedDronesResultObject
    | ListPlanetsResultObject
    | HyperspaceJumpResultObject
    | VisitedSectorsResultObject
    | TradePromptObject
    | TradeConfirmPromptObject
    | TradeCompleteObject
    | TradeSkippedObject
    | PreviousSectorResultObject
    | AttackMenuResultObject
    | StarbaseInfoResultObject
    | TerraformInfoResultObject
    | HardwareStoreInfoResultObject
    | NeighborhoodResultObject
    | DeployMineResultObject
    | ListDeployedMinesResultObject
    | TrackSeekerMinesResultObject
    | MineDisruptorResultObject
    | ProximityMineHitEvent
    | SeekerMineAttachedEvent
    | SeekerMinePickupAlertEvent
    | ErrorResultObject;

/**
 * Pure menu transition — server tells the client "you're now in this menu"
 * with no accompanying data payload. The client mirrors the `menu` field
 * into `ctx.world.mode` and the framework re-renders the menu's prompt.
 */
export type MenuTransitionResult = {
    type: typeof ServerMsgType.MenuTransition;
    menu: MenuName;
};

/**
 * Distributive intersection: adds `menu: MenuName` to every variant of T.
 * Required because `Omit<A | B, K>` does NOT distribute by default; this
 * conditional-type form does.
 */
type WithMenu<T> = T extends unknown ? T & { menu: MenuName } : never;

/**
 * Wire-format envelope additions that aren't part of any ServerResult
 * variant. `suppressPrompt: true` tells the client framework "more
 * messages are coming on this same player action" — skip the auto
 * renderPrompt so the menu prompt doesn't paint between transient
 * envelopes (e.g. DockResult → TradePrompt, TradeComplete → next
 * TradePrompt or UndockResult). The terminal envelope in the chain
 * omits the flag and triggers the prompt as usual.
 */
type EnvelopeFlags = { suppressPrompt?: boolean };

/**
 * Wire-format type the client receives. Every server message has both a
 * `type` discriminator and a `menu` field. `MenuTransitionResult` covers
 * pure menu changes that carry no other data.
 */
export type ServerMessage = (WithMenu<ServerResult> | MenuTransitionResult) & EnvelopeFlags;
