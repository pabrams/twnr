// hex-grid spatial constants: server bakes them into sector coords at
// generation, client uses them to interpret those coords when rendering
export const HEX_CELL_SIZE = 100;
export const HEX_SPACING_MULTIPLIER = 1.4;

export type ShipConfig = {
    slug: string;
    displayName?: string;
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
    slug: string;
    displayName?: string;
    description: string;
    /** Deaths per 1000 colos per day from environmental hazard. Combined
     *  with the universe-level dailyReproductionPer1000Colos to compute
     *  the planet's net colonist trajectory. */
    danger: number;
    maxFuelColos: number;
    maxOrgColos: number;
    maxEquColos: number;
    maxFuel: number;
    maxOrg: number;
    maxEqu: number;
    maxDrones: number;
    maxDroneColos: number;
    maxCitadel: number;
    fuelProduction: number;
    organicsProduction: number;
    equipmentProduction: number;
    droneProduction: number;
};

export type ShipCatalogEntry = {
    id: number;
    name: string;
    display_name: string | null;
    make: string | null;
    sort_order: number;
    max_drones: number;
    max_shields: number;
    starting_holds: number;
    max_holds: number;
    odds_offensive: number;
    odds_defensive: number;
    has_pod: boolean;
    can_land: boolean;
    has_interdictor: boolean;
    has_planetary_defense_bonus: boolean;
    planetary_defense_odds: number | null;
    speed: number;
    turns_per_warp: number;
    cost_drive: number;
    cost_computer: number;
    cost_hull: number;
    hold_cost: number;
    max_drone_attack: number;
    transporter_range: number;
    has_tractor: boolean;
    piloting_restriction: string | null;
    notes: string | null;
    basic_hold_cost: number;
    base_cost: number;
    hardware: Record<string, number>;
};

export type AuthTokenPayload = {
    userId: number;
    name?: string;
    role?: string;
    tokenVersion: number;
};

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

export type MenuCommandEntry = {
    command: string;
    keyPattern: string;
    label: string;
    targetMenu: string | null;
    sortOrder: number;
};

export type MenuEntry = {
    name: string;
    label: string;
    parentMenu: string | null;
    commands: MenuCommandEntry[];
};
