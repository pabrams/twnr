/**
 * Combat: attack-player menu, drone encounter, attack quantity prompts.
 */

import { makeDomain } from './_domain.js';

export const COMBAT = makeDomain('COMBAT', {
    attackNoTargets: '\r\n[br]No other players in this sector.[/br]',
    attackHeader: '[c]Attack — Select target:[/c]',
    attackTarget: '  [by]{n}[/by]  [w]{name}[/w]',
    attackPrompt:
        '\r\n[mg]Target[/mg] [mg]([/mg][by]?[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',

    attackQtyPrompt: '\r\n[c]How many drones to attack with?[/c] ',

    droneEncounterHeader: '[br]=== HOSTILE DRONES DETECTED ===[/br]',
    droneSectorCount: '  [by]Sector drones[/by]: [br]{count}[/br] (owned by [by]{owner}[/by])',
    droneShipCount: '  [by]Your ship drones[/by]: [w]{count}[/w]',
    droneNoDrones: '[br]You have no drones! You must retreat.[/br]',
    droneEncounterPrompt:
        '\r\n[mg]Drone encounter[/mg] [mg]([/mg][by]A[/by][mg]/[/mg][by]R[/by][mg])[/mg] [by]?[/by] ',

    droneAttackQtyPrompt: '\r\n[c]How many drones to send?[/c] ',
});
