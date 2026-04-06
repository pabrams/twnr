import { colorPalette, buildColors } from '../config/colors.js';

export const colors = buildColors(colorPalette);

export const PORT_CLASS_LABELS: Record<number, string> = {
    0: 'Special',
    1: 'BBS',
    2: 'BSB',
    3: 'SBB',
    4: 'SSB',
    5: 'BSS',
    6: 'SBS',
    7: 'SSS',
    8: 'BBB',
    9: 'Special',
};

export const PORT_CLASS_ACTIONS: Record<number, Record<string, 'B' | 'S'>> = {
    1: { fuel: 'B', organics: 'B', equipment: 'S' },
    2: { fuel: 'B', organics: 'S', equipment: 'B' },
    3: { fuel: 'S', organics: 'B', equipment: 'B' },
    4: { fuel: 'S', organics: 'S', equipment: 'B' },
    5: { fuel: 'B', organics: 'S', equipment: 'S' },
    6: { fuel: 'S', organics: 'B', equipment: 'S' },
    7: { fuel: 'S', organics: 'S', equipment: 'S' },
    8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

export enum MenuMode {
    Sector = 'sector',
    Port = 'port',
    Docked = 'docked',
    Help = 'help',
    ShipInfo = 'shipInfo',
    Attack = 'attack',
    AttackFighters = 'attackFighters',
    Computer = 'computer',
    KnownUniverse = 'knownUniverse',
    ShipCatalog = 'shipCatalog',
    PlanetSpecs = 'planetSpecs',
    Class0 = 'class0',
    Class0Qty = 'class0Qty',
    PlayerInfo = 'playerInfo',
    AutopilotPrompt = 'autopilotPrompt',
    Autopilot = 'autopilot',
    JettisonConfirm = 'jettisonConfirm',
    Planet = 'planet',
    PlanetTakeQty = 'planetTakeQty',
    PlanetLeaveQty = 'planetLeaveQty',
    DeployFightersQty = 'deployFightersQty',
    FighterEncounter = 'fighterEncounter',
    FighterAttackQty = 'fighterAttackQty',
}
