/**
 * Multi-line info panels: ship info, players online.
 */

import { makeDomain } from './_domain.js';

export const PANEL = makeDomain('PANEL', {
    playerInfo: '{{MSG.playerInfoName}}',
    playerInfoSector: '{{MSG.playerInfoSector}}',
    shipName: '[mg]Ship Type[/mg]          [by]:[/by] [bc]{name}[/bc]',
    shipClan: '[mg]Clan[/mg]               [by]:[/by] [bc]#{num}[/bc] [bc]{name}[/bc]',
    // X / Y values are right-padded into a fixed column so digit-length
    // variation doesn't desync the layout. `{cur}` and `{max}` arrive
    // pre-padded by ship-exchange.ts to widths of CUR_W and MAX_W.
    shipDronesShields:
        '[mg]Drones[/mg]             [by]:[/by] [bc]{drones}[/bc] [g]/[/g] [c]{maxDrones}[/c]\r\n' +
        '[mg]Shields[/mg]            [by]:[/by] [bc]{shields}[/bc] [g]/[/g] [c]{maxShields}[/c]',
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

    deployedDronesEmpty: '[g]No drones deployed.[/g]',
    deployedDronesTitle: '                 [bc]Deployed  Drone  Scan[/bc]',
    deployedDronesColumns:
        ' [bw]Sector      Drones    Personal/Clan    Mode        Tolls[/bw]',
    deployedDronesRule:
        '[g]===========================================================[/g]',
    deployedDronesRow:
        '  [bc]{sector}[/bc]      [bc]{qty}[/bc]      [bc]{kind}[/bc]   [g]{mode}[/g]   [w]{tolls}[/w]',
    deployedDronesTotalsRow:
        '              [bc]{qty} Total[/bc]                          [w]{tolls} Total[/w]',

    deployedMinesEmpty: '[g]No mines deployed.[/g]',
    deployedMinesTitle: '       [bc]Deployed  {label}  Scan[/bc]',
    deployedMinesColumns: ' [bw]Sector      Mines     Personal/Clan[/bw]',
    deployedMinesRule: '[g]====================================[/g]',
    deployedMinesRow:
        '  [bc]{sector}[/bc]      [bc]{qty}[/bc]      [bc]{kind}[/bc]',
    deployedMinesTotalsRow: '              [bc]{qty} Total[/bc]',

    limpetScanTitle: 'Activated  [bc]Limpet  Scan[/bc]',
    limpetScanColumns: ' [bw]Sector    Personal/Clan[/bw]',
    limpetScanRule: '[g]========================[/g]',
    limpetScanRow: '  [bc]{sector}[/bc]      [bc]{kind}[/bc]',
    limpetScanTotalsRow: '              [bc]{qty} Total[/bc]',

    densityScanTitle: '                          [bc]Relative Density Scan[/bc]',
    densityScanRule:
        '[g]-----------------------------------------------------------------------------[/g]',
    densityScanRow:
        '[mg]Sector[/mg]  {sector}  ==>  {density}  [mg]Warps :[/mg] {warps}    ' +
        '[mg]NavHaz :[/mg] {navHaz}    [mg]Anom :[/mg] {anom}',
    densityScanSectorVisited: '[bc]{n}[/bc] ',
    densityScanSectorUnvisited: '[mg]([/mg][br]{n}[/br][mg])[/mg]',
    visualScanPrompt:
        '\r\n[mg]Spend a turn for a visual scan?[/mg] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [N][/mg] ',
});
