/**
 * Gameplay events: combat, drones, terraforming, hyperspace, alerts.
 */

import { makeDomain } from './_domain.js';

export const EVENT = makeDomain('EVENT', {
    autopilotEngaged: '\r\n[bg:b]<Autopilot engaging>[/bg:b]',
    autopilotDisengaged: '\r\n[br]Autopilot disengaged — hostile drones![/br]',
    autopilotCancelled: '\r\n[br]Autopilot cancelled.[/br]',
    autopilotResuming: '[bc]Autopilot resuming...[/bc]',
    autopilotWarping: '\r\n[y]Auto-warping to sector [by]{sector}[/by][/y]',
    autopilotArrived: '\r\n[bc]Arriving at sector [by]{sector}[/by]. Autopilot disengaging.[/bc]',
    noPathFound: '\r\n[br]No path found to that sector.[/br]',
    noShip: '\r\n[br]You do not have a ship.[/br]',
    shipDestroyed: '\r\n[br]*** Your ship was destroyed: {reason} ***[/br]',

    attackDestroyed: '[br]{message}[/br]',
    attackCompleted: '[by]{message}[/by]',
    attackStat: '  [by]{label}[/by]: {value}',

    deployDronesInfo:
        '[g]You have [by]{total}[/by] drones available.[/g]\r\n' +
        '[g]Your ship can support a maximum of [by]{max}[/by] drones, so you have to leave at least [by]{minInSector}[/by].[/g]',

    deployDronesPrompt: '[g]How many drones do you want defending this sector? [{minInSector}][/g]',
    deployOwnershipPrompt:
        '\r\n[mg]Deploy as ([/mg][by]P[/by][mg]ersonal, [/mg][by]C[/by][mg]lan, [/mg][by]Q[/by][mg]) [/mg][by]?[/by] ',

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

    terraformDevicesAvailable: '\r\n[g]You have[/g] [bc]{count}[/bc] [g]Terraform Devices.[/g]',
    terraformNoDevices: '\r\n[bg]You have no Terraform Devices.[/bg]',
    terraformConfirm:
        '[by]Terraform a planet in this sector?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',
    terraformSuccess: '\r\n[bg]Terraform successful![/bg] Created [bc]{name}[/bc] ({type})',
    terraformCollision: '[by:r]*** Warning ***: intersecting orbits detected![/by:r]',
    terraformDevicesRemaining: '  [by]Terraform devices remaining[/by]: [bc]{count}[/bc]',
    terraformFailure: '\r\n[br]{reason}[/br]',

    hyperspaceJump:
        '\r\n[bg]Hyperspace jump![/bg] Arrived in sector [bc]{sector}[/bc]. Fuel used: [by]{fuel}[/by], Turns: [by]{turns}[/by]',

    leftPlanet: '\r\n[y]You return to your ship and leave the planet.[/y]',
    noPlanetsToLand:
        "\r\n[g]There's no planet in this sector.[/g]" +
        '\r\n[g]You can create one with a terraform device.[/g]',
});
