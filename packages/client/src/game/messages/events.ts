/**
 * Gameplay events: combat, drones, terraforming, hyperspace, alerts.
 */

import { makeDomain } from './_domain.js';

export const EVENT = makeDomain('EVENT', {
    autopilotDisengaged: '\r\n[br]Autopilot disengaged — hostile drones![/br]',
    autopilotCancelled: '\r\n[br]Autopilot cancelled.[/br]',
    autopilotResuming: '[bc]Autopilot resuming...[/bc]',
    noPathFound: '\r\n[br]No path found to that sector.[/br]',
    noShip: '\r\n[br]You do not have a ship.[/br]',

    attackDestroyed: '[br]{message}[/br]',
    attackCompleted: '[by]{message}[/by]',
    attackStat: '  [by]{label}[/by]: {value}',

    deployDronesInfo:
        'You have [by]{ship + sector}[/by] drones available.\r\n' +
        'Your ship can support a maximum of [by]{max}[/by] drones, so you have to leave at least [by]{Max(ship + sector - max, 0)}[/by].',

    deployDronesPrompt: '[g]How many drones do you want defending this sector? [{Max(ship + sector - max, 0)}][/g]',

    deployDronesResult:
        '\r\n[bc]Done. You have [by]{ship}[/by] drones in close support and [by]{sector}[/by] defending the sector.[/bc]',

    combatLost:
        '[by]Combat:[/by] Lost [br]{lost}[/br] drones. Sector drones remaining: [br]{remaining}[/br]. Ship drones: [w]{ship}[/w]',
    sectorCleared: '[bg]Sector cleared![/bg]',
    retreated: '\r\n[by]Retreated to sector[/by] [bc]{sector}[/bc]',

    alertIntrusion:
        '[by]Alert:[/by] Drones in sector [bc]{sector}[/bc] report [bm]{intruder}[/bm] warped into the sector.',
    alertAttacked:
        '[br]Alert:[/br] [bm]{intruder}[/bm] destroyed [by]{lost}[/by] of your drones in sector [bc]{sector}[/bc]!',
    alertDestroyed:
        '[br]Alert:[/br] [bm]{intruder}[/bm] destroyed all your drones in sector [bc]{sector}[/bc]!',

    planetDestroyed: '\r\n[br]Planet {name} destroyed![/br]',

    terraformSuccess: '\r\n[bg]Terraform successful![/bg] Created [bc]{name}[/bc] ({type})',
    terraformCollision: '[by:r]*** Warning ***: intersecting orbits detected![/by:r]',
    terraformDevicesRemaining: '  [by]Terraform devices remaining[/by]: [bc]{count}[/bc]',
    terraformFailure: '\r\n[br]{reason}[/br]',

    hyperspaceJump:
        '\r\n[bg]Hyperspace jump![/bg] Arrived in sector [bc]{sector}[/bc]. Fuel used: [by]{fuel}[/by], Turns: [by]{turns}[/by]',

    leftPlanet: '\r\n[w]You return to your ship and leave the planet.[/w]',
    noPlanetsToLand: '\r\n[w]No planets in this sector.[/w]',
});
