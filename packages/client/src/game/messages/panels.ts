/**
 * Multi-line info panels: ship info, cargo info, players online,
 * planet detail, list panels.
 */

export const PANEL = {
    shipName: '[w]Ship:[/w] [bc]{name}[/bc]',
    shipDronesShields:
        '  [by]Drones[/by]: [w]{drones}[/w]/[c]{maxDrones}[/c]  [by]Shields[/by]: [w]{shields}[/w]/[c]{maxShields}[/c]',
    shipHolds:
        '  [by]Cargo holds[/by]: [bg]{free} free[/bg] / [w]{total} total[/w] [mg]([/mg]max {max}[mg])[/mg]',
    shipCargo:
        '  [by]Fuel[/by]: {fuel}  [by]Organics[/by]: {organics}  [by]Equipment[/by]: {equipment}  [by]Colonists[/by]: {colonists}',
    shipCreditsTurns:
        '  [by]Credits[/by]: [by]{credits}[/by]  [by]Turns[/by]: [w]{turns}[/w]',

    cargoInfoCredits: '  [by]Credits[/by]: [by]{credits}[/by]',

    playersOnlineHeader: '[bc]Players Online[/bc] ({count}):',
    playersOnlineRow: '  [by]{name}[/by]{suffix}',
    playersOnlineYouTag: ' [bg](you)[/bg]',

    takeColonistsHeader: '[bg]You took {qty} {commodity} colonists.[/bg]',
    leaveColonistsHeader: '[bg]You left {qty} {commodity} colonists.[/bg]',
    planetColonistsLine: '  [by]Planet colonists[/by]: [w]{count}[/w]',
    shipColonistsLine: '  [by]Ship colonists[/by]: [w]{count}[/w]',

    landedHeader: '[bg]Landed on[/bg] [bc]{name}[/bc]',
    landedType: '  [by]Type[/by]: {type}',
    landedStats:
        '  [by]Drones[/by]: {drones}  [by]Fuel[/by]: {fuel}  [by]Organics[/by]: {organics}  [by]Equipment[/by]: {equipment}',
    landedColonists:
        '  [by]Colonists[/by]: Fuel={fuel}, Org={org}, Equ={equ}',

    planetDisplayHeader: '[bc]{name}[/bc] ({type})',

    deployedDronesEmpty: '[w]No drones deployed.[/w]',
    deployedDronesHeader: '[bc]Deployed Drones:[/bc]',
    deployedDronesRow: '  Sector [by]{sector}[/by]: [w]{qty}[/w] drones',

    listPlanetsEmpty: '[w]You own no planets.[/w]',
    listPlanetsHeader: '[bc]=== Your Planets ===[/bc]',
    listPlanetsRow:
        '  [by]Sector {sector}[/by] — [bc]{name}[/bc] ([w]{type}[/w])',
    listPlanetsColonists:
        '    Fuel col: {fuel}  Org col: {org}  Equ col: {equ}',
} as const;
