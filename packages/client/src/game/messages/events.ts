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
        'Your ship can support a maximum of [y]{max}[/y] drones, so you have to leave at least [y]{Max(ship + sector - max, 0)}[/y].',

    deployDronesPrompt: '[g]How many drones do you want defending this sector?[/g]',

    deployDronesResult:
        '\r\n[bc]Done. You have [by]{ship}[/by] drones in close support and [by]{sector}[/by] defending the sector.[/bc]',

    combatLost:
        '[by]Combat:[/by] Lost [br]{lost}[/br] drones. Sector drones remaining: [br]{remaining}[/br]. Ship drones: [w]{ship}[/w]',
    sectorCleared: '[bg]Sector cleared![/bg]',
    retreated: '\r\n[by]Retreated to sector[/by] [bc]{sector}[/bc]',

    alertIntrusion:
        '[by]Alert:[/by] [br]{intruder}[/br] entered sector [bc]{sector}[/bc] with your drones!',
    alertAttacked:
        '[br]Alert:[/br] [br]{intruder}[/br] attacked your drones in sector [bc]{sector}[/bc]! Lost: {lost}, remaining: {remaining}',
    alertDestroyed:
        '[br]Alert:[/br] [br]{intruder}[/br] destroyed all your drones in sector [bc]{sector}[/bc]!',

    planetDestroyed: '\r\n[br]Planet {name} destroyed![/br]',

    terraformSuccess: '\r\n[bg]Terraform successful![/bg] Created [bc]{name}[/bc] ({type})',
    terraformCollision: '[by]Warning: planetary collision detected![/by]',
    terraformDevicesRemaining: '  [by]Terraform devices remaining[/by]: {count}',
    terraformFailure: '\r\n[br]{reason}[/br]',

    hyperspaceJump:
        '\r\n[bg]Hyperspace jump![/bg] Arrived at sector [bc]{sector}[/bc]. Fuel used: {fuel}, Turns: {turns}',

    leftPlanet: '\r\n[w]You return to your ship and leave the planet.[/w]',
    noPlanetsToLand: '\r\n[w]No planets in this sector.[/w]',
});
