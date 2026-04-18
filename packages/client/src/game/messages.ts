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

export const MSG = {
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

    portMenuHeader:
        '[bc]{name}[/bc][by],[/by] [mg]Class[/mg] [bc]{class}[/bc] [mg]([/mg][bw]{label}[/bw][mg])[/mg]',
    portMenuNoPort: '\r\n[br]No port in this sector.[/br]',
    portMenuStarbase: '  [c]S[/c]  Enter Starbase',
    portMenuTrade: '  [c]T[/c]  Trade at this port',
    portMenuCancel: '  [c]Q[/c]  Never mind',

    commerceHeader: '[bg]Commerce report for[/bg] [bc]{name}[/bc]',
    commerceColumns:
        ' [bw]{items}[/bw][bw]{status}[/bw][bw]{trading}[/bw] [bw]{pct}[/bw] [bw]{onBoard}[/bw]',
    commerceDividers: ' [w]{items}[/w][w]{status}[/w][w]{trading}[/w] [w]{pct}[/w] [w]{onBoard}[/w]',
    commerceRowBuying:
        ' [bc]{name}[/bc][g]{status}[/g][bc]{trading}[/bc] [g]{pct}[/g] [c]{onBoard}[/c]',
    commerceRowSelling:
        ' [bc]{name}[/bc][g]{status}[/g][bc]{trading}[/bc] [g]{pct}[/g] [c]{onBoard}[/c]',
    commerceFooter:
        '[mg]You have[/mg] [by]{credits}[/by] [mg]credits and[/mg] [by]{holds}[/by] [mg]empty cargo holds.[/mg]',

    playerInfoName: '[bg]Player[/bg]: [bc]{name}[/bc]',
    playerInfoSector: '[bg]Sector[/bg]: [bc]{sector}[/bc]',
} as const;
