/**
 * Centralized message templates using BBCode-style tags.
 *
 *   [mg]...[/mg]  magenta        [bg]...[/bg]  bold green
 *   [by]...[/by]  bold yellow    [bc]...[/bc]  bold cyan
 *   [br]...[/br]  bold red       [bw]...[/bw]  bold white
 *   [w]...[/w]    dim white      [c]...[/c]    cyan
 *   [g]...[/g]    green
 *
 * {name} placeholders are replaced via render(template, vars).
 */

import { makeDomain } from './messages/_domain.js';

export const MSG = makeDomain('MSG', {
    sectorHeader: '[bg]Sector[/bg]  [by]:[/by] [bc]{sector}[/bc]',

    portLine:
        '[mg]Port[/mg]    [by]:[/by] [bc]{name}[/bc][by],[/by] [mg]Class[/mg] [bc]{class}[/bc] [mg]([/mg][bw]{label}[/bw][mg])[/mg]',

    dronesYours: '[mg]Drones[/mg]  [by]:[/by] [bg]{qty}[/bg] [mg]([bw]yours[/bw])[/mg]',
    dronesEnemy: '[mg]Drones[/mg]  [by]:[/by] [br]{qty}[/br] [mg]([/mg][by]{owner}[/by][mg])[/mg]',

    planetsHeader: '[mg]Planets[/mg] [by]:[/by] {list}',
    planetItem: '[bc]{name}[/bc] [mg]([/mg][w]{type}[/w][mg])[/mg]',

    collisionWarning:
        '[br]WARNING[/br]: [by]{planet}[/by] on collision course with [by]{target}[/by]! [mg]([/mg]ETA: [br]{hours}[/br]h[mg])[/mg]',

    warpsHeader: '[bg]Warps[/bg]   [by]:[/by] {list}',
    warpVisited: '[bc]{sector}[/bc]',
    warpUnvisited: '[mg]([/mg][br]{sector}[/br][mg])[/mg]',

    playersHeader: '[mg]Players[/mg] [by]:[/by] {list}',
    playerItem: '[by]{name}[/by]',

    shipsHeader: '[mg]Ships[/mg]   [by]:[/by] {list}',
    shipItem: '[bc]{type}[/bc] [mg]([/mg][by]{owner}[/by][mg])[/mg]',

    prompt:
        '\r\n[mg]Command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]:[/by] ',

    helpHeader: '[c]Help:[/c]',
    helpLineText: '[c]{label}:[/c] {text}',
    helpLineKey: "[c]{label}:[/c] [by]'{key}'[/by] {text}",

    portMenuNoPort: '\r\n[br]No port in this sector.[/br]',
    portMenuStarbase: '  [c]S[/c]  Enter Starbase',
    portMenuTrade: '  [c]T[/c]  Trade at this port',
    portMenuCancel: '  [c]Q[/c]  Never mind',

    playerInfoName: '[mg]Merchant Name[/mg]  [by]:[/by] [g]{name}[/g]',
    playerInfoSector: '[mg]Sector[/mg]         [by]:[/by] [bc]{sector}[/bc]',
    fuelQuantity: '[g]Fuel[/g][by]=[/by][bc]{fuel}[/bc]',
    orgQuantity: '[g]Org[/g][by]=[/by][bc]{organics}[/bc]',
    equQuantity: '[g]Equ[/g][by]=[/by][bc]{equipment}[/bc]',
    colosQuantity: '[g]Colos[/g][by]=[/by][bc]{colonists}[/bc]',
});