import { makeDomain } from './_domain.js';

export const COMBAT = makeDomain('COMBAT', {
    attackNoTargets: '\r\n[br]No other players in this sector.[/br]',
    attackTargetPrompt:
        "[by]Attack {name}'s {ship} ({drones}-{targetDrones})[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg][by]?[/by] ",
    attackQtyPrompt:
        '[by]How many drones do you wish to use (0 to {max})[/by] [mg][[/mg][by]0[/by][mg]][/mg][by]?[/by] ',
    attackDronesLost: '[g]You lost [by]{lost}[/by] drone(s), [by]{remaining}[/by] remain.[/g]',
    attackDronesDestroyed:
        '[g]You destroyed [by]{destroyed}[/by] enemy drones, [by]{remaining}[/by] remain.[/g]',
    attackShipDestroyed: "[br]You destroyed {name}'s {ship}![/br]",

    droneEncounterHeader: '[br]=== HOSTILE DRONES DETECTED ===[/br]',
    droneSectorCount: '  [by]Sector drones[/by]: [br]{count}[/br] [by](belong to {owner})[/by]',
    droneShipCount: '  [by]Your ship drones[/by]: [g]{count}[/g]',
    droneNoDrones: '[br]You have no drones! You must retreat.[/br]',
    droneEncounterPrompt:
        '\r\n[mg]Drone encounter[/mg] [mg]([/mg][by]A[/by][mg]/[/mg][by]R[/by][mg])[/mg] [by]?[/by] ',

    droneAttackQtyPrompt: '\r\n[c]How many drones to send?[/c] ',
});
