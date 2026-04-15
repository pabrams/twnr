// Config types (loaded from JSON on server, sent to client via API)

export type ShipConfig = {
    name: string;
    sortOrder: number;
    speed: number;
    startingHolds: number;
    maxHolds: number;
    maxShields: number;
    maxDrones: number;
    oddsOffensive: number;
    oddsDefensive: number;
    maxDroneAttack: number;
    turnsPerWarp: number;
    costDrive: number;
    costComputer: number;
    costHull: number;
    holdCost: number;
    maxBuoy: number;
    maxProximity: number;
    maxOrbital: number;
    maxSeeker: number;
    maxTerraformDevices: number;
    maxPlanetBusters: number;
    maxCloaking: number;
    maxCorbomite: number;
    maxPhoton: number;
    maxDisruptors: number;
    maxReconDrones: number;
    transporterRange: number;
    hasPod: boolean;
    canLand: boolean;
    hasInterdictor: boolean;
    hasTractor: boolean;
    canHaveHyperspace1: boolean;
    canHaveHyperspace2: boolean;
    canHaveVisualScanner: boolean;
    canHavePlanetScanner: boolean;
    make?: string;
    hasPlanetaryDefenseBonus?: boolean;
    planetaryDefenseOdds?: number;
    pilotingRestriction?: string;
    notes?: string;
};

export type PlanetConfig = {
    type: string;
    description: string;
    maxColonists: number;
    maxCitadel: number;
    fuelProduction: number;
    organicsProduction: number;
    equipmentProduction: number;
};

// Auth

export type AuthTokenPayload = {
    userId: number;
    name?: string;
    role?: string;
    tokenVersion: number;
};

// HTTP API response shapes (auth & admin only)

export type AuthResponse = {
    userId: number;
    name?: string;
    role: string;
    token: string;
};

export type LogoutResponse = {
    success: boolean;
};

export type ServerStatsResponse = {
    uptime: number;
    playersOnline: number;
    totalPlayers: number;
    totalSectors: number;
    nodeVersion: string;
    platform: string;
};

// Server envelope: wraps every WS response with the player's current menu
export type ServerEnvelope<T = import('./server-messages.js').ServerResult> = {
    menu: string;
    payload: T;
};

// Menu registry types (fetched via /api/menu-registry)
export type MenuCommandEntry = {
    command: string;
    keyPattern: string;
    label: string;
    clientMsgType: string | null;
    targetMenu: string | null;
    sortOrder: number;
};

export type MenuEntry = {
    name: string;
    label: string;
    parentMenu: string | null;
    commands: MenuCommandEntry[];
};
