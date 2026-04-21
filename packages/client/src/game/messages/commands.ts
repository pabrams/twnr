/**
 * Command echoes — rendered by sendMsg before a client→server command goes out.
 * Key is the ClientMsgType string; template vars are the message's own fields.
 * No entry = no echo. Edit freely.
 */

import { makeDomain } from './_domain.js';

export const COMMAND = makeDomain('COMMAND', {
    move: '[bw]<Move>[/bw] [g]Warping to sector[/g] [bc]{sector}[/bc]',
    moveToPrevious: '[bw]<Move to Previous>[/bw]',
    sectorDisplay: '[bw]<Re-Display>[/bw]',
    playersOnline: '[bw]<Players Online>[/bw]',
    // shortestPath: '[bw]<Shortest Path>[/bw] [g]from[/g] [bc]{from}[/bc] [g]to[/g] [bc]{to}[/bc]',
    shortestPath: '',
    portInfo: '[bw]<Port Info>[/bw]',
    shipInfo: '[bw]<Ship Info>[/bw]',
    dock: '[bw]<Dock>[/bw]',
    undock: '[bw]<Undock>[/bw]',
    jettison: '[bw]<Jettison>[/bw]',
    land: '[bw]<Land>[/bw]',
    landOnPlanet: '[bw]<Land on Planet>[/bw]',
    leavePlanet: '[bw]<Leave Planet>[/bw]',
    takeColonists: '[bw]<Take Colonists>[/bw]',
    leaveColonists: '[bw]<Leave Colonists>[/bw]',
    deployDronesInfo: '[bw]<Deploy Drones>[/bw]',
    deployDrones: '[bw]<Deploy Drones>[/bw]',
    attack: '[bw]<Attack>[/bw]',
    starbaseInfo: '[bw]<Starbase Info>[/bw]',
    quit: '[bw]<Quit>[/bw]',
    terraformInfo: '[bw]<Terraform>[/bw]',
    attackShip: '[bw]<Attack Ship>[/bw]',
    attackSectorDrones: '[bw]<Attack Sector Drones>[/bw]',
    retreatFromDrones: '[bw]<Retreat>[/bw]',
    useTerraformDevice: '[bw]<Terraform>[/bw]',
    destroyPlanet: '[bw]<Destroy Planet>[/bw]',
    dockStarbase: '[bw]<Enter Starbase>[/bw]',
    leaveStarbase: '[bw]<Leave Starbase>[/bw]',
    buyHardware: '[bw]<Buy Hardware>[/bw]',
    buyDrones: '[bw]<Buy Drones>[/bw]',
    buyShields: '[bw]<Buy Shields>[/bw]',
    buyHolds: '[bw]<Buy Holds>[/bw]',
    buyShipNew: '[bw]<Buy Ship>[/bw]',
    buyShipTradein: '[bw]<Trade In Ship>[/bw]',
    hyperspaceJump: '[bw]<Hyperspace Jump>[/bw]',
    listDeployedDrones: '[bw]<List Deployed Drones>[/bw]',
    listPlanets: '[bw]<List Planets>[/bw]',
    visitedSectors: '[bw]<Visited Sectors>[/bw]',
    planetDisplay: '[bw]<Planet Info>[/bw]',
    warpsOut: '[bw]<Warps Out>[/bw]',
    portTransaction: '[bw]<Port Transaction>[/bw]',
});
