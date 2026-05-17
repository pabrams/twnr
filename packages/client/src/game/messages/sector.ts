/**
 * Sector display — header line, port, drones, planets, warps, players, ships.
 * Also the main command prompt, player-info header, autopilot prompts.
 */

import { makeDomain } from './_domain.js';

export const SECTOR = makeDomain('SECTOR', {
    header: '[bg]Sector[/bg]  [by]:[/by] [bc]{sector}[/bc]',

    port: '[mg]Port[/mg]    [by]:[/by] [bc]{name}[/bc][by],[/by] [mg]Class[/mg] [bc]{class}[/bc] [mg]([/mg]{label}[mg])[/mg]',

    dronesYours: '[mg]Drones[/mg]  [by]:[/by] [bc]{qty}[/bc] [mg](yours)[/mg]',
    dronesYourClan: '[mg]Drones[/mg]  [by]:[/by] [bc]{qty}[/bc] [mg](belong to your clan)[/mg]',
    dronesEnemy: '[mg]Drones[/mg]  [by]:[/by] [br]{qty}[/br] [mg]([/mg]{ownership}[mg])[/mg]',
    ownershipClan: '[w]owned by clan[/w] [bc]#{num}[/bc][by]:[/by] [bc]{name}[/bc]',
    ownershipPlayer: '[w]owned by[/w] [by]{name}[/by]',
    ownershipYours: '[mg]yours[/mg]',
    ownershipYourClan: '[mg]belong to your clan[/mg]',
    ownershipRogue: '[br]Rogue[/br]',

    planetsLine: '[mg]Planets[/mg] [by]:[/by] {item}',
    planetsContinuation: '          {item}',
    planetItem: '{nameColored} [mg]([/mg]{type}[mg])[/mg]',
    planetItemPlain: '[bc]{name}[/bc] [mg]([/mg]{type}[mg])[/mg]',

    collisionWarning:
        '[br]WARNING[/br]: [by]{planet}[/by] on collision course with [by]{target}[/by]! [mg]([/mg]ETA: [br]{hours}[/br]h[mg])[/mg]',

    warpsLine: '[bg]Warps[/bg]   [by]:[/by] {list}',
    warpVisited: '[bc]{sector}[/bc]',
    warpUnvisited: '[mg]([/mg][br]{sector}[/br][mg])[/mg]',
    warpSeparator: ' [g]-[/g] ',

    tradersLine: '[mg]Traders[/mg] [by]:[/by] {item}',
    tradersContinuation: '          {item}',
    traderItemColored:
        '[by]{name}[/by]{clanSuffix}[by],[/by] w/ [bc]{drones}[/bc] ftrs, in [by]{shipName}[/by] [mg]([/mg]{shipTypeColored}[mg])[/mg]',
    traderItemPlain:
        '[by]{name}[/by]{clanSuffix}[by],[/by] w/ [bc]{drones}[/bc] ftrs, in [by]{shipName}[/by] [mg]([/mg][bc]{shipType}[/bc][mg])[/mg]',
    traderClanSuffix: ' [mg][[/mg][bc]{num}[/bc][mg]][/mg]',

    shipsLine: '[mg]Ships[/mg]   [by]:[/by] {item}',
    shipsContinuation: '          {item}',
    shipItemColored:
        '[by]{shipName}[/by] [mg]([/mg]{shipTypeColored}[mg], [/mg]{ownership}[mg])[/mg] w/ [bc]{drones}[/bc] ftrs',
    shipItemPlain:
        '[by]{shipName}[/by] [mg]([/mg][bc]{shipType}[/bc][mg], [/mg]{ownership}[mg])[/mg] w/ [bc]{drones}[/bc] ftrs',
    ownershipPlayerOwnedBy: '[w]Owned by[/w] [by]{name}[/by]{clanSuffix}',

    minesLine: '[mg]Mines[/mg]   [by]:[/by] [bc]{qty}[/bc] [mg](yours)[/mg]',
    minesLineYourClan: '[mg]Mines[/mg]   [by]:[/by] [bc]{qty}[/bc] [mg](belong to your clan)[/mg]',
    minesLineEnemy: '[mg]Mines[/mg]   [by]:[/by] [br]{qty}[/br] [mg]([/mg]{ownership}[mg])[/mg]',
    limpetsLine: '[mg]Limpets[/mg] [by]:[/by] [bc]{qty}[/bc] [mg](yours)[/mg]',
    limpetsLineYourClan:
        '[mg]Limpets[/mg] [by]:[/by] [bc]{qty}[/bc] [mg](belong to your clan)[/mg]',
    limpetsLineEnemy: '[mg]Limpets[/mg] [by]:[/by] [br]{qty}[/br] [mg]([/mg]{ownership}[mg])[/mg]',

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

    beaconBanner: '[bc]<Release Beacon>[/bc]',
    beaconLaunchPrompt:
        'Do you wish to launch a Marker Beacon here? [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [N][/mg] ',
    beaconMessagePrompt: 'What message should be on this beacon? (41 chars)\r\n',
    beaconLaunched: '[bg]Beacon Launched![/bg]',
    beaconCollision:
        '[br]Your beacon collides with the one that was already here and both detonate![/br]',
    beaconNoBeacons: '[br]No beacons on board![/br]',
    beaconLine: '[mg]Beacon[/mg]  [by]:[/by] [br]{message}[/br]',

    attackBeaconPrompt:
        'Destroy the Marker Beacon here? [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [N][/mg] ',
    attackBeaconDestroyed:
        '[bg]You launch a drone which quickly destroys the Beacon (and itself)[/bg]',

    noPlanet:
        '[w]There is no planet in this sector. You could create one with a Terraform Device.[/w]',

    moveMenuHeader: '[bm]Adjacent sectors[/bm]',
    moveMenuRow: '  [mg]<[/mg][g]{n}[/g][mg]>[/mg] {sector}',
    moveMenuQuit: '  [mg]<[/mg][g]Q[/g][mg]>[/mg] [by]Cancel[/by]',
    moveMenuPrompt:
        '\r\n[mg]Select warp[/mg] [mg]([/mg][by]1[/by]-[by]{max}[/by],[by]Q[/by][mg])[/mg] [by]:[/by] ',
});
