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

    minesLine: '[mg]Mines[/mg]   [by]:[/by] {list}',
    mineItemOwn: '[bc]{qty}[/bc] [mg]{label} (yours)[/mg]',
    mineItemEnemy: '[br]{qty}[/br] [mg]{label}[/mg]',
    mineLabelProximity: 'proximity',
    mineLabelSeeker: 'seeker',

    commaJoin: '[by], [/by]',

    prompt: '\r\n[mg]Command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]:[/by] ',

    playerInfoName: '{{MSG.playerInfoName}}',
    playerInfoSector: '{{MSG.playerInfoSector}}',

    jettisonConfirm:
        '\r\n[br]Are you sure you want to jettison all your cargo?[/br] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',

    autopilotNotAdjacent:
        '[g]That sector is not adjacent.[g]\r\n' +
        '\r\n[g]The Shortest path [mg]({hops} hops, {turns} turns)[/mg] from sector [by]{from}[/by] to sector [by]{to}[/by] is[by]:[/by]',
    autopilotPathSeparator: ' [g]>[/g] ',
    autopilotConfirm:
        '\r\n[mg]Engage the autopilot?[/mg] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [Y][/mg] ',

    noPlanet:
        '[w]There is no planet in this sector. You could create one with a Terraform Device.[/w]',

    moveMenuHeader: '[bm]Adjacent sectors[/bm]',
    moveMenuRow: '  [mg]<[/mg][g]{n}[/g][mg]>[/mg] {sector}',
    moveMenuQuit: '  [mg]<[/mg][g]Q[/g][mg]>[/mg] [by]Cancel[/by]',
    moveMenuPrompt:
        '\r\n[mg]Select warp[/mg] [mg]([/mg][by]1[/by]-[by]{max}[/by],[by]Q[/by][mg])[/mg] [by]:[/by] ',
});
