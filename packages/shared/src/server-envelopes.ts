// WebSocket messages (server → client)

import { ServerTag, type MenuName } from './tags.js';

/** A sector number with player-specific visited flag. */
export type SectorRef = {
    sector: number;
    visited: boolean;
};

export type WelcomeEvent = {
    type: typeof ServerTag.Welcome;
    playerId: number;
    name: string;
    sector: number;
    token: string;
    totalSectors: number;
    shipName: string;
    coloredShipName: string | null;
    starbaseSector: number | null;
    location: MenuName;
    isGuest: boolean;
    isAdmin: boolean;
    clanId: number | null;
};

export type TowedAlong = {
    kind: 'manned' | 'unmanned';
    name: string;
    shipTypeDisplayName: string | null;
    shipTypeName: string;
};

export type PlayerMovedEvent = {
    type: typeof ServerTag.PlayerMoved;
    playerId: number;
    playerName: string;
    sector: number;
    direction: 'in' | 'out';
    towedAlong?: TowedAlong;
};

export type OwnershipInfo =
    | { kind: 'player'; name: string; playerId: number; ownerClanNumber: number | null }
    | { kind: 'clan'; name: string; clanNumber: number; clanId: number }
    | { kind: 'rogue' };

export type SectorDroneInfo = {
    quantity: number;
    ownerId: number | null;
    ownership: OwnershipInfo;
};

export type CollisionInfo = {
    planetName: string;
    collidingWithName: string;
    collisionAt: string;
};

export type SectorMineEntry = {
    mineType: 'proximity' | 'seeker';
    quantity: number;
    own: boolean;
    ownership: OwnershipInfo;
};

export type SectorBeaconInfo = {
    message: string;
    ownership: OwnershipInfo;
};

export type SectorDisplayData = {
    sector: number;
    players: {
        id: number;
        name: string;
        clanNumber: number | null;
        shipName: string;
        shipTypeName: string;
        shipTypeDisplayName: string | null;
        drones: number;
    }[];
    warps: SectorRef[];
    port?: { class: number; name: string } | null;
    sectorDrones?: SectorDroneInfo | null;
    planets: { id: number; name: string; type: string; displayType: string | null }[];
    ships?: {
        id: number;
        name: string;
        typeName: string;
        typeDisplayName: string | null;
        drones: number;
        ownership: OwnershipInfo;
    }[];
    collisions?: CollisionInfo[];
    sectorMines?: SectorMineEntry[];
    beacon?: SectorBeaconInfo | null;
};

export type SectorDisplayReply = {
    type: typeof ServerTag.SectorDisplayResult;
} & SectorDisplayData;

export type MoveReply =
    | ({
          type: typeof ServerTag.MoveResult;
          outcome: 'success';
          turnsUsed?: number;
          towedAlong?: TowedAlong;
          freedFromTow?: true;
      } & SectorDisplayData)
    | ({
          type: typeof ServerTag.MoveResult;
          outcome: 'encounter';
          ownerId: number | null;
          ownerName: string;
          shipDrones: number;
          retreatSector: number;
          turnsUsed?: number;
          towedAlong?: TowedAlong;
          freedFromTow?: true;
      } & SectorDisplayData)
    | { type: typeof ServerTag.MoveResult; outcome: 'nonAdjacent'; sector: number }
    | { type: typeof ServerTag.MoveResult; outcome: 'noShip' }
    | { type: typeof ServerTag.MoveResult; outcome: 'destroyed'; reason: string }
    | { type: typeof ServerTag.MoveResult; outcome: 'error'; message: string };

export type PlayerLeftEvent = {
    type: typeof ServerTag.PlayerLeft;
    playerId: number;
};

export type PlayersOnlineReply = {
    type: typeof ServerTag.PlayersOnlineResult;
    players: { id: number; name: string }[];
};

export type NoShipReply = {
    type: typeof ServerTag.NoShip;
};

export type NonAdjacentMoveReply = {
    type: typeof ServerTag.NonAdjacentMoveRequested;
    playerId: number;
    sector: number;
};

export type RateLimitedEvent = {
    type: typeof ServerTag.RateLimited;
};

export type WarpsOutReply = {
    type: typeof ServerTag.WarpsOutResult;
    id: number;
    warps: SectorRef[];
};

export type ShortestPathReply = {
    type: typeof ServerTag.ShortestPathResult;
    path: SectorRef[];
    hops: number;
    turns: number;
};

export type PortInfoReply = {
    type: typeof ServerTag.PortInfoResult;
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

export type ShipInfoReply = {
    type: typeof ServerTag.ShipInfoResult;
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
    clanNumber: number | null;
    clanName: string | null;
};

export type PortTransactionReply = {
    type: typeof ServerTag.PortTransactionResult;
    credits: number;
    cargo: { fuel: number; organics: number; equipment: number; colonists: number };
    emptyHolds: number;
    turnsUsed?: number;
};

export type BuyDronesReply = {
    type: typeof ServerTag.BuyDronesResult;
    credits: number;
    drones: number;
};

export type BuyShieldsReply = {
    type: typeof ServerTag.BuyShieldsResult;
    credits: number;
    shields: number;
};

export type BuyHoldsReply = {
    type: typeof ServerTag.BuyHoldsResult;
    credits: number;
    cargoLimit: number;
    turnsUsed?: number;
};

export type BuyShipTradeinReply = {
    type: typeof ServerTag.BuyShipTradeinResult;
    shipName: string;
    coloredShipName: string | null;
    credits: number;
    maxDrones: number;
    maxShields: number;
    cargoLimit: number;
};

export type AttackShipReply = {
    type: typeof ServerTag.AttackShipResult;
    destroyed: boolean;
    attackerDronesLost: number;
    defenderShieldsLost: number;
    defenderDronesLost: number;
    message?: string;
};

export type DockReply = {
    type: typeof ServerTag.DockResult;
    docked: boolean;
    port?: PortInfoReply;
    credits?: number;
    cargo?: { fuel: number; organics: number; equipment: number; colonists: number };
    emptyHolds?: number;
    /** Set when docking broke the player out of an active tow. */
    freedFromTow?: true;
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

export type PlanetInfoReply = {
    type: typeof ServerTag.PlanetInfoResult;
    sectorId: number;
    name: string;
    planetType: string;
    displayType: string | null;
    colonists: number;
    hasPlanet: boolean;
};

export type UseTerraformDeviceReply = {
    type: typeof ServerTag.UseTerraformDeviceResult;
    success: boolean;
    reason?: string;
    planet?: {
        id: number;
        name: string;
        type: string;
        displayType: string | null;
        sectorId: number;
    };
    collision?: boolean;
    terraformDevices?: number;
};

export type GetSectorPlanetsReply = {
    type: typeof ServerTag.GetSectorPlanetsResult;
    planets: { id: number; name: string; type: string; displayType: string | null }[];
};

export type PlanetDisplayData = {
    id: number;
    sector_id: number;
    name: string;
    planetType: string;
    displayType: string | null;
    owner_name: string | null;
    drones: number;
    fuel: number;
    organics: number;
    equipment: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    colonists_drones: number;
    empty_holds: number;
    ship_colonists: number;
    ship_drones: number;
    ship_max_drones: number;
    ship_fuel: number;
    ship_organics: number;
    ship_equipment: number;
    fuel_production: number;
    organics_production: number;
    equipment_production: number;
    drone_production: number;
    max_fuel: number;
    max_org: number;
    max_equ: number;
    max_drones: number;
    max_fuel_colos: number;
    max_org_colos: number;
    max_equ_colos: number;
    max_drone_colos: number;
    colos_per_unit_per_hour: number;
    created_at: Date | string;
    updated_at?: Date | string | null;
};

export type LandOnPlanetReply = {
    type: typeof ServerTag.LandOnPlanetResult;
} & PlanetDisplayData;

export type PlanetDisplayReply = {
    type: typeof ServerTag.PlanetDisplayResult;
} & PlanetDisplayData;

export type DestroyPlanetReply = {
    type: typeof ServerTag.DestroyPlanetResult;
    destroyed: boolean;
    planetId: number;
    planetName: string;
};

export type BuyHardwareReply = {
    type: typeof ServerTag.BuyHardwareResult;
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

export type DockStarbaseReply = {
    type: typeof ServerTag.DockStarbaseResult;
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

export type TakeColonistsReply = {
    type: typeof ServerTag.TakeColonistsResult;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
    planetColonists: number;
    shipColonists: number;
} & Partial<SectorDisplayData>;

export type LeaveColonistsReply = {
    type: typeof ServerTag.LeaveColonistsResult;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
    planetColonists: number;
    shipColonists: number;
} & Partial<SectorDisplayData>;

export type TakeCommodityReply = {
    type: typeof ServerTag.TakeCommodityResult;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
    planetCommodity: number;
    shipCommodity: number;
};

export type LeaveCommodityReply = {
    type: typeof ServerTag.LeaveCommodityResult;
    quantity: number;
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones';
    planetCommodity: number;
    shipCommodity: number;
};

export type DeployDronesInfoReply = {
    type: typeof ServerTag.DeployDronesInfoResult;
    sectorDrones: number;
    shipDrones: number;
    shipMaxDrones: number;
};

export type DeployDronesReply = {
    type: typeof ServerTag.DeployDronesResult;
    sectorDrones: number;
    shipDrones: number;
};

export type AttackSectorDronesReply = {
    type: typeof ServerTag.AttackSectorDronesResult;
    victory: boolean;
    dronesLost: number;
    sectorDronesRemaining: number;
    shipDrones: number;
};

export type RetreatFromDronesReply = {
    type: typeof ServerTag.RetreatFromDronesResult;
    sector: number;
};

export type SectorDronesAlertEvent = {
    type: typeof ServerTag.SectorDronesAlert;
    event: 'intrusion' | 'attacked' | 'destroyed';
    sector: number;
    dronesLost: number;
    dronesRemaining: number;
    intruderName: string;
};

export type JettisonReply =
    | {
          type: typeof ServerTag.JettisonResult;
          outcome: 'success';
          jettisoned: { fuel: number; organics: number; equipment: number; colonists: number };
      }
    | { type: typeof ServerTag.JettisonResult; outcome: 'error'; message: string };

export type UndockReply =
    | ({
          type: typeof ServerTag.UndockResult;
          outcome: 'success';
      } & SectorDisplayData)
    | { type: typeof ServerTag.UndockResult; outcome: 'error'; message: string };

export type LeavePlanetReply = {
    type: typeof ServerTag.LeavePlanetResult;
    turnsUsed?: number;
};

export type LeaveStarbaseReply = {
    type: typeof ServerTag.LeaveStarbaseResult;
} & SectorDisplayData;

export type BuyShipNewReply = {
    type: typeof ServerTag.BuyShipNewResult;
    shipName: string;
    coloredShipName: string | null;
    credits: number;
    maxDrones: number;
    maxShields: number;
    cargoLimit: number;
};

export type ListDeployedDronesReply = {
    type: typeof ServerTag.ListDeployedDronesResult;
    drones: {
        sectorId: number;
        quantity: number;
        ownerLabel: string;
        ownership: OwnershipInfo;
    }[];
};

export type HyperspaceJumpReply = {
    type: typeof ServerTag.HyperspaceJumpResult;
    targetSector: number;
    fuelUsed: number;
    turnsUsed: number;
};

export type ErrorReply = {
    type: typeof ServerTag.Error;
    message: string;
};

export type VisitedSectorsReply = {
    type: typeof ServerTag.VisitedSectorsResult;
    sectors: number[];
    totalSectors: number;
};

export type ListPlanetsReply = {
    type: typeof ServerTag.ListPlanetsResult;
    planets: {
        id: number;
        sectorNumber: number;
        name: string;
        type: string;
        displayType: string | null;
        drones: number;
        fuel: number;
        organics: number;
        equipment: number;
        colonists_fuel: number;
        colonists_organics: number;
        colonists_equipment: number;
        colonists_drones: number;
    }[];
};

export type PreviousSectorReply = {
    type: typeof ServerTag.PreviousSectorResult;
    sector: number | null;
};

export type ShipDetailReply = {
    type: typeof ServerTag.ShipDetailResult;
    shipId: number;
    shipNumber: number;
    typeName: string;
    typeDisplayName: string | null;
    sector: number | null;
    drones: number;
    maxDrones: number;
    shields: number;
    maxShields: number;
    holds: number;
    maxHolds: number;
    transporterRange: number;
    cargoFuel: number;
    cargoOrganics: number;
    cargoEquipment: number;
    cargoColonists: number;
    ownership: OwnershipInfo;
    hardware: Record<string, number>;
    hardwareMax: Record<string, number>;
};

export type TransportToShipReply = {
    type: typeof ServerTag.TransportToShipResult;
    targetShipId: number;
    targetSector: number;
    turnsUsed: number;
    turnsRemaining: number;
};

export type ClanCreateReply = {
    type: typeof ServerTag.ClanCreateResult;
    clanId: number;
    clanNumber: number;
    name: string;
};

export type ClanJoinReply = {
    type: typeof ServerTag.ClanJoinResult;
    clanId: number;
    clanNumber: number;
    name: string;
};

export type ClanLeaveReply = {
    type: typeof ServerTag.ClanLeaveResult;
    outcome: 'left' | 'dissolved';
    convertedToPersonal: number;
    convertedToRogue: number;
};

export type ClanListEntry = {
    clanId: number;
    clanNumber: number;
    name: string;
    memberCount: number;
    leaderName: string;
    isOwn: boolean;
};

export type ClanListReply = {
    type: typeof ServerTag.ClanListResult;
    viewerClanId: number | null;
    clans: ClanListEntry[];
};

export type ClanMemberEntry = {
    playerId: number;
    name: string;
    isLeader: boolean;
};

export type ChangeShipOwnershipReply = {
    type: typeof ServerTag.ChangeShipOwnershipResult;
    shipId: number;
    ownership: 'personal' | 'clan';
};

export type ClaimPlanetReply = {
    type: typeof ServerTag.ClaimPlanetResult;
    planetId: number;
    planetName: string;
    ownership: 'personal' | 'clan';
};

export type ClanTransferReply = {
    type: typeof ServerTag.ClanTransferResult;
    kind: 'credits' | 'drones' | 'shields' | 'mines';
    targetPlayerId: number;
    targetName: string;
    quantity: number;
    delivered: number;
};

export type ClanMemoReply = {
    type: typeof ServerTag.ClanMemoResult;
    recipientCount: number;
};

export type ClanSetPasswordReply = {
    type: typeof ServerTag.ClanSetPasswordResult;
};

export type ClanDropMemberReply = {
    type: typeof ServerTag.ClanDropMemberResult;
    droppedPlayerId: number;
    droppedName: string;
};

export type ClanMembershipChangedEvent = {
    type: typeof ServerTag.ClanMembershipChanged;
    clanId: number | null;
    reason: 'dropped' | 'dissolved' | 'other';
};

export type MemoDeliveryEvent = {
    type: typeof ServerTag.MemoDelivery;
    memos: {
        id: number;
        senderName: string | null;
        kind: string;
        body: string;
        createdAt: string;
    }[];
};

export type ClanInfoReply = {
    type: typeof ServerTag.ClanInfoResult;
    clan: {
        clanId: number;
        clanNumber: number;
        name: string;
        leaderPlayerId: number;
        members: ClanMemberEntry[];
        maxSize: number;
    } | null;
};

export type ListOwnedShipsReply = {
    type: typeof ServerTag.ListOwnedShipsResult;
    currentSector: number;
    currentShipId: number | null;
    currentShipTypeName: string | null;
    currentShipTypeDisplayName: string | null;
    currentShipTransporterRange: number | null;
    viewerClanId: number | null;
    ships: {
        id: number;
        shipNumber: number;
        sector: number | null;
        drones: number;
        shields: number;
        holds: number;
        hops: number | null;
        typeName: string;
        typeDisplayName: string | null;
        transporterRange: number;
        ownerPlayerId: number | null;
        ownerClanId: number | null;
        ownerLabel: string;
    }[];
};

export type GetAttackTargetsReply = {
    type: typeof ServerTag.GetAttackTargetsResult;
    players: { id: number; name: string }[];
    beaconPresent: boolean;
};

export type ReleaseBeaconReply = {
    type: typeof ServerTag.ReleaseBeaconResult;
    outcome: 'launched' | 'collision' | 'noBeacons';
    sector: number;
    beaconsRemaining: number;
};

export type AttackBeaconReply = {
    type: typeof ServerTag.AttackBeaconResult;
    destroyed: boolean;
    shipDrones: number;
};

export type DensityScanEntry = {
    sector: number;
    visited: boolean;
    /** Sum of density scores per the scoring rule. */
    density: number;
    warps: number;
    /** Nav-hazard percentage 0-100. Always 0 for now. */
    navHaz: number;
    /** True if any limpet (seeker) mines present. */
    anom: boolean;
};

/** Density-scan reply also carries the viewer's visual-scanner status so
 *  the client can decide whether to offer the follow-up visual scan
 *  without an extra round-trip. */
export type DensityScanReply = {
    type: typeof ServerTag.DensityScanResult;
    entries: DensityScanEntry[];
    hasVisualScanner: boolean;
};

/** Visual scan reply: a full sector display for each out-warp sector,
 *  rendered back to back by the client. Deducts one turn server-side. */
export type VisualScanReply = {
    type: typeof ServerTag.VisualScanResult;
    sectors: SectorDisplayData[];
};

export type StarbaseInfoReply = {
    type: typeof ServerTag.StarbaseInfoResult;
    sector: number | null;
    universeName: string;
    sectorCount: number;
    portCount: number;
    createdAt: string;
    daysElapsed: number;
    outWarpDistribution: number[];
    maxPlanetsPerSector: number;
    startingCredits: number;
    startingTurns: number;
    startingDrones: number;
    startingHolds: number;
    respawnDelaySeconds: number;
};

export type TerraformInfoReply = {
    type: typeof ServerTag.TerraformInfoResult;
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

export type HardwareStoreInfoReply = {
    type: typeof ServerTag.HardwareStoreInfoResult;
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

export type DeployMineInfoReply = {
    type: typeof ServerTag.DeployMineInfoResult;
    mineType: 'proximity' | 'seeker';
    sectorMines: number;
    shipMines: number;
    shipMaxMines: number;
};

export type DeployMineReply = {
    type: typeof ServerTag.DeployMineResult;
    mineType: 'proximity' | 'seeker';
    sectorMines: number;
    shipMines: number;
};

export type DeployedMineEntry = {
    sectorNumber: number;
    mineType: 'proximity' | 'seeker';
    quantity: number;
    ownerLabel: string;
    ownership: OwnershipInfo;
};

export type ListDeployedMinesReply = {
    type: typeof ServerTag.ListDeployedMinesResult;
    mines: DeployedMineEntry[];
};

export type TrackedSeekerMineEntry = {
    targetShipId: number;
    targetShipName: string;
    targetOwnerName: string;
    sectorNumber: number;
};

export type TrackSeekerMinesReply = {
    type: typeof ServerTag.TrackSeekerMinesResult;
    targets: TrackedSeekerMineEntry[];
};

export type MineDisruptorReply = {
    type: typeof ServerTag.MineDisruptorResult;
    targetSector: number;
    minesDisrupted: number;
    proximityMinesRemaining: number;
};

export type ProximityMineHitEvent = {
    type: typeof ServerTag.ProximityMineHit;
    sector: number;
    detonations: number;
    damage: number;
    shieldsLost: number;
    dronesLost: number;
    destroyed: boolean;
};

export type SeekerMineAttachedEvent = {
    type: typeof ServerTag.SeekerMineAttached;
    sector: number;
    droppedPrevious: boolean;
};

export type SeekerMinePickupAlertEvent = {
    type: typeof ServerTag.SeekerMinePickupAlert;
    sector: number;
    targetShipName: string;
    targetOwnerName: string;
};

export type NeighborhoodReply = {
    type: typeof ServerTag.NeighborhoodResult;
    topology: 'random' | 'proximal';
    current_sector_id: number;
    sectors: NeighborhoodSector[];
    warps: NeighborhoodWarp[];
};

export type ShipNameRequiredEvent = {
    type: typeof ServerTag.ShipNameRequired;
    reason: 'initial' | 'respawn' | 'buyNew' | 'tradein';
    shipTypeDisplayName: string;
    shipTypeName: string;
};

export type SetShipNameReply = {
    type: typeof ServerTag.SetShipNameResult;
    outcome: 'ok' | 'invalid' | 'error';
    message?: string;
};

export type TowableMannedEntry = {
    playerId: number;
    playerName: string;
    clanNumber: number | null;
    shipId: number;
    shipName: string;
    shipTypeName: string;
    shipTypeDisplayName: string | null;
    drones: number;
};

export type TowableUnmannedEntry = {
    shipId: number;
    shipName: string;
    shipTypeName: string;
    shipTypeDisplayName: string | null;
    drones: number;
    ownership: OwnershipInfo;
};

export type TowSpacecraftReply =
    | { type: typeof ServerTag.TowSpacecraftResult; outcome: 'disengaged'; message: string }
    | { type: typeof ServerTag.TowSpacecraftResult; outcome: 'none' }
    | {
          type: typeof ServerTag.TowSpacecraftResult;
          outcome: 'options';
          sector: number;
          manned: TowableMannedEntry[];
          unmanned: TowableUnmannedEntry[];
      };

export type TowAttachReply =
    | {
          type: typeof ServerTag.TowAttachResult;
          outcome: 'ok';
          message: string;
          turnsPerWarp: number;
      }
    | { type: typeof ServerTag.TowAttachResult; outcome: 'error'; message: string };

export type TowReleasedAlertEvent = {
    type: typeof ServerTag.TowReleasedAlert;
    towedName: string;
};

export type TowAttachedAlertEvent = {
    type: typeof ServerTag.TowAttachedAlert;
    towingName: string;
};

export type ServerEnvelope =
    | WelcomeEvent
    | PlayerMovedEvent
    | SectorDisplayReply
    | MoveReply
    | UndockReply
    | JettisonReply
    | LeavePlanetReply
    | LeaveStarbaseReply
    | PlayerLeftEvent
    | PlayersOnlineReply
    | NoShipReply
    | NonAdjacentMoveReply
    | RateLimitedEvent
    | WarpsOutReply
    | ShortestPathReply
    | PortInfoReply
    | ShipInfoReply
    | PortTransactionReply
    | BuyDronesReply
    | BuyShieldsReply
    | BuyHoldsReply
    | BuyShipTradeinReply
    | AttackShipReply
    | DockReply
    | PlanetInfoReply
    | TakeColonistsReply
    | LeaveColonistsReply
    | TakeCommodityReply
    | LeaveCommodityReply
    | DeployDronesInfoReply
    | DeployDronesReply
    | AttackSectorDronesReply
    | RetreatFromDronesReply
    | SectorDronesAlertEvent
    | UseTerraformDeviceReply
    | GetSectorPlanetsReply
    | LandOnPlanetReply
    | PlanetDisplayReply
    | DestroyPlanetReply
    | BuyHardwareReply
    | DockStarbaseReply
    | BuyShipNewReply
    | ListDeployedDronesReply
    | ListPlanetsReply
    | HyperspaceJumpReply
    | VisitedSectorsReply
    | PreviousSectorReply
    | GetAttackTargetsReply
    | StarbaseInfoReply
    | TerraformInfoReply
    | HardwareStoreInfoReply
    | NeighborhoodReply
    | DeployMineInfoReply
    | DeployMineReply
    | ListDeployedMinesReply
    | TrackSeekerMinesReply
    | MineDisruptorReply
    | ProximityMineHitEvent
    | SeekerMineAttachedEvent
    | SeekerMinePickupAlertEvent
    | ListOwnedShipsReply
    | ShipDetailReply
    | TransportToShipReply
    | ClanCreateReply
    | ClanJoinReply
    | ClanLeaveReply
    | ClanListReply
    | ClanInfoReply
    | ChangeShipOwnershipReply
    | ClaimPlanetReply
    | ClanTransferReply
    | ClanMemoReply
    | ClanSetPasswordReply
    | ClanDropMemberReply
    | ClanMembershipChangedEvent
    | ReleaseBeaconReply
    | AttackBeaconReply
    | DensityScanReply
    | VisualScanReply
    | MemoDeliveryEvent
    | ShipNameRequiredEvent
    | SetShipNameReply
    | TowSpacecraftReply
    | TowAttachReply
    | TowReleasedAlertEvent
    | TowAttachedAlertEvent
    | ErrorReply;
