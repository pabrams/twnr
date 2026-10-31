// Menu names (must match the server's `menu` table seed data)

export const Menu = {
    Sector: 'sector',
    Port: 'port',
    Class0: 'class0',
    Attack: 'attack',
    Computer: 'computer',
    AutopilotPrompt: 'autopilotPrompt',
    Autopilot: 'autopilot',
    Planet: 'planet',
    DroneEncounter: 'droneEncounter',
    Starbase: 'starbase',
    StarbaseHardware: 'starbaseHardware',
    PlanetEarth: 'planetEarth',
    Shipyards: 'shipyards',
    ShipyardsClass0: 'shipyardsClass0',
    Clan: 'clan',
    Base: 'base',
    BaseComputer: 'baseComputer',
} as const;
export type MenuName = (typeof Menu)[keyof typeof Menu];
