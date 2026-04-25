/**
 * Multi-line info panels: ship info, cargo info, players online,
 * planet detail, list panels.
 */

import { makeDomain } from './_domain.js';

export const PANEL = makeDomain('PANEL', {
    playerInfo: '{{MSG.playerInfoName}}',
    playerInfoSector: '{{MSG.playerInfoSector}}',
    shipName: '[mg]Ship Type[/mg]          [by]:[/by] [bc]{name}[/bc]',
    shipDronesShields:
        '[mg]Drones[/mg]             [by]:[/by] [bc]{drones}[/bc] [g]/[/g] [c]{maxDrones}[/c] \r\n' +
        '[mg]Shields[/mg]            [by]:[/by] [bc]{shields}[/bc] [g]/[/g] [c]{maxShields}[/c] ',
    shipHolds:
        '[mg]Cargo holds[/mg]        [by]:[/by] [bc]{free}[/bc] [g]free[/g] [g]/[/g] [c]{total}[/c] ' +
        '[g]total[/g] [mg]([/mg][g]max[/g] [c]{max}[/c][mg])[/mg]',
    shipCargo:
        '[mg]Cargo[/mg]              [by]:[/by] ' +
        '{{MSG.fuelQuantity}} ' +
        '{{MSG.orgQuantity}} ' +
        '{{MSG.equQuantity}} ' +
        '{{MSG.colosQuantity}}',
    shipCreditsTurns:
        '[mg]Turns[/mg]              [by]:[/by] [bc]{turns}[/bc]\r\n' +
        '[mg]Credits[/mg]            [by]:[/by] [bc]{credits}[/bc]',
    shipTurnsPerWarp: '[mg]Turns per warp[/mg]     [by]:[/by] [bc]{turns}[/bc]',
    shipHardwareRowStackable: '[mg]{label}[/mg] [by]:[/by] [bc]{qty}[/bc] [g]/[/g] [c]{max}[/c]',
    shipHardwareRowToggleOn: '[mg]{label}[/mg] [by]:[/by] [bg]installed[/bg]',
    shipHardwareRowToggleOff: '[mg]{label}[/mg] [by]:[/by] [w]—[/w]',
    shipHardwareRowUnavailable: '[mg]{label}[/mg] [by]:[/by] [w]n/a[/w]',

    playersOnlineHeader: '[bc]Players Online[/bc] ({count}):',
    playersOnlineRow: '  [by]{name}[/by]{suffix}',
    playersOnlineYouTag: ' [bg](you)[/bg]',

    takeColonistsHeader: '[bg]You took [bc]{qty}[/bc] colonists.[/bg]',
    leaveColonistsHeader: '[bg]You left [bc]{qty}[/bc] colonists.[/bg]',
    planetColonistsLine: '  [g]There are [/g]: [by]{count}[/by] colonists remaining on the planet.',
    shipColonistsLine: '  [by]Ship colonists[/by]: [w]{count}[/w]',

    landedHeader: '[bg]Landed on[/bg] [bc]{name}[/bc]',
    landedType: '  [by]Type[/by]: {type}',
    landedStats: '  [by]Drones[/by]: {drones}  ',
    landedColonists:
        '  [by]Colonists[/by]: {{MSG.fuelQuantity}}, {{MSG.orgQuantity}}, {{MSG.equQuantity}}',

    planetDisplayHeader: '[bc]{name}[/bc] ({type})',

    deployedDronesEmpty: '[g]No drones deployed.[/g]',
    deployedDronesHeader: '[bc]Deployed Drones:[/bc]',
    deployedDronesRow: '  Sector [by]{sector}[/by]: [bc]{qty}[/bc] drones',

    listPlanetsEmpty: '[br]You own no planets.[/br]',
    listPlanetsHeader: '[bc]=== Your Planets ===[/bc]',
    listPlanetsRow: '  [by]Sector {sector}[/by] — [bc]{name}[/bc] ([w]{type}[/w])',
    listPlanetsColonists:
        '  Colonists: {{MSG.fuelQuantity}}, {{MSG.orgQuantity}}, {{MSG.equQuantity}}',
});
