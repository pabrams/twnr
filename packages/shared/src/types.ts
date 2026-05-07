export const DEFAULT_WARP_DIST_1_6: readonly number[] = [25, 25, 25, 15, 8, 2];
export const DEFAULT_TWO_WAY_PCT = 98;
export const DEFAULT_PORT_DENSITY = 80;
export const DEFAULT_TOPOLOGY: 'random' | 'proximal' = 'proximal';
/** Default number of sectors when generating a universe (admin form + guest
 *  auto-bootstrap both pull from this). */
export const DEFAULT_SECTOR_COUNT = 500;
/** Fraction of hex grid cells that hold a sector (0–1). Lower = more empty space. */
export const DEFAULT_FILL_DENSITY = 0.8;
/** Diameter target for wormhole sprinkling: BFS eccentricity ≤ this. */
export const DEFAULT_MAX_PATH_LENGTH = 25;
/** Hex "size" parameter in world units — used as the unit for label/pill sizing
 *  on the client. Adjacent center-to-center distance is √3 × HEX_CELL_SIZE ×
 *  HEX_SPACING_MULTIPLIER. */
export const HEX_CELL_SIZE = 100;
/** Multiplier on the bigbang-time hex layout coordinates to give adjacent
 *  pills more breathing room without growing the pills themselves. Tuned so
 *  multi-digit sector numbers leave clear visible warp segments between
 *  adjacent pills. Affects new universes only — existing rows in the DB
 *  keep whatever spacing they were generated with. */
export const HEX_SPACING_MULTIPLIER = 1.4;

export type ShipConfig = {
    name: string;
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
    type: string;
    description: string;
    maxColonists: number;
    maxCitadel: number;
    fuelProduction: number;
    organicsProduction: number;
    equipmentProduction: number;
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

export type ServerEnvelope<T = import('./server-messages.js').ServerResult> = {
    menu: string;
    payload?: T;
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
