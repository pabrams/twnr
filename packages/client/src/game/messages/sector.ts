/**
 * Sector display — header line, port, drones, planets, warps, players, ships.
 * Also the main command prompt, player-info header, autopilot prompts.
 */

import { makeDomain } from './_domain.js';

export const SECTOR = makeDomain('SECTOR', {
    header: '[bg]Sector[/bg]  [by]:[/by] [bc]{sector}[/bc]',

    port: '[mg]Port[/mg]    [by]:[/by] [bc]{name}[/bc][by],[/by] [mg]Class[/mg] [bc]{class}[/bc] [mg]([/mg]{label}[mg])[/mg]',

    dronesYours: '[mg]Drones[/mg]  [by]:[/by] [bc]{qty}[/bc] [mg](yours)[/mg]',
    dronesEnemy: '[mg]Drones[/mg]  [by]:[/by] [br]{qty}[/br] [mg]([/mg][by]{owner}[/by][mg])[/mg]',

    planetsLine: '[mg]Planets[/mg] [by]:[/by] {list}',
    planetItem: '[bc]{name}[/bc] [mg]([/mg][w]{type}[/w][mg])[/mg]',

    collisionWarning:
        '[br]WARNING[/br]: [by]{planet}[/by] on collision course with [by]{target}[/by]! [mg]([/mg]ETA: [br]{hours}[/br]h[mg])[/mg]',

    warpsLine: '[bg]Warps[/bg]   [by]:[/by] {list}',
    warpVisited: '[bc]{sector}[/bc]',
    warpUnvisited: '[mg]([/mg][br]{sector}[/br][mg])[/mg]',
    warpSeparator: ' [g]-[/g] ',

    playersLine: '[mg]Merchants[/mg] [by]:[/by] {list}',
    playerItem: '[by]{name}[/by]',

    shipsLine: '[mg]Ships[/mg]     [by]:[/by] {list}',
    shipItem: '[bc]{type}[/bc] [mg]([/mg][by]{owner}[/by][mg])[/mg]',

    commaJoin: '[by], [/by]',

    prompt: '\r\n[mg]Command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]:[/by] ',

    playerInfoName: '{{MSG.playerInfoName}}',
    playerInfoSector: '{{MSG.playerInfoSector}}',

    jettisonConfirm:
        '\r\n[by]Jettison all cargo?[/by] This cannot be undone. [mg]([/mg][by]y[/by]/[by]n[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',

    autopilotNotAdjacent:
        '[by]That sector is not adjacent.[/by] Shortest path [mg]([/mg][bc]{hops}[/bc] hops[mg])[/mg]:',
    autopilotPathSeparator: ' [g]>[/g] ',
    autopilotConfirm: '\r\n[c]Engage autopilot?[/c] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] ',

    noPlanet:
        '[w]There is no planet in this sector. You could create one with a Terraform Device.[/w]',
});
