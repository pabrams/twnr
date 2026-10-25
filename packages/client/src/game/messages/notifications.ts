import { makeDomain } from './_domain.js';

export const NOTIFY = makeDomain('NOTIFY', {
    connected: '[g]Connected to TWNR.[/g]',
    connectionError: '\r\n[br]Connection error.[/br]',
    connectionDropped: '\r\n[br]*** Connection dropped: {reason} ***[/br]',
    connectionDroppedNoReason: '\r\n[br]*** Connection dropped ***[/br]',
    reconnectPrompt:
        '\r\n[y]Press [by]<Enter>[/by] to re-enter the universe, or [by]<Esc>[/by] to leave.[/y]',
    leavePrompt: '\r\n[y]Press [by]<Esc>[/by] to leave.[/y]',
    reconnecting: '\r\n[bc]Reconnecting...[/bc]',
    deletingGuest:
        '\r\n[by]*** Your guest account ([bm]{name}[/bm]) may be deleted at any time ***[/by]',

    welcome: '\r\n[bg]Welcome, {name}.[/bg]',
    welcomeGuest:
        '\r\n[by]*** Guest demo account ***[/by]' +
        '\r\n[y]This account and its progress may be deleted at any time after you log out or disconnect.[/y]' +
        '\r\n[y]Register an email account to keep your progress.[/y]',
    goodbye: '\r\n[br]Disconnecting...[/br]',

    playerIn: '\r\n[by][bm]{name}[/bm] warped into the sector.[/by]',
    playerOut: '\r\n[y][bm]{name}[/bm] warped out of the sector.[/y]',

    playerLandsPlanet: '\r\n[y][bm]{name}[/bm] lands on {planet}.[/y]',
    playerLandsPlanetUnknown: '\r\n[y][bm]{name}[/bm] lands on a planet.[/y]',
    playerLiftsOff: '\r\n[by][bm]{name}[/bm] lifts off {planet}.[/by]',
    playerLiftsOffUnknown: '\r\n[by][bm]{name}[/bm] lifts off a planet.[/by]',
    playerDocks: '\r\n[y][bm]{name}[/bm] docks at {port}.[/y]',
    playerDocksUnknown: '\r\n[y][bm]{name}[/bm] docks at the port.[/y]',
    playerUndocks: '\r\n[by]The [bm]{ship}[/bm] undocks from {port}.[/by]',
    playerUndocksUnknownPort: '\r\n[by]The [bm]{ship}[/bm] undocks from the port.[/by]',
    playerUndocksUnknownShip: '\r\n[by][bm]{name}[/bm] undocks from the port.[/by]',

    starbaseLocation:
        '\r\n[br]***[/br] [bc]Starbase[/bc] [g]is in sector[/g] [by]{sector}[/by] [br]***[/br] ',
    noStarbase: '\r\n[br]No Starbase in this universe.[/br]',

    universeStatsHeader: '\r\n[bc]=== Universe «{name}» ===[/bc]',
    universeStatsLine: '  [g]{label}[/g] [by]:[/by] [bc]{value}[/bc]',
    universeStatsCreated:
        '  [g]Created[/g] [by]:[/by] [bc]{date}[/bc] [g]([/g][by]{days}[/by] [g]days ago)[/g]',
    universeStatsDegHeader: '\r\n[bc]Out-warp degree distribution[/bc]',
    universeStatsDegRow: '  [g]{degree} warp{s}:[/g] [by]{count}[/by] [g]sector{ss}[/g]',
    universeStatsRespawnNone: '  [g]Respawn delay[/g] [by]:[/by] [bc]none[/bc]',
    universeStatsRespawnSeconds: '  [g]Respawn delay[/g] [by]:[/by] [bc]{value}[/bc]',

    error: '\r\n[r]{message}[/r]',
    invalidSelection: '[br]Invalid selection.[/br]',

    unknownCommand: 'Unknown command: {cmd}',

    noPreviousSector: '\r\n[br]No previous sector to return to.[/br]',
    quitConfirm:
        '\r\n[by]Are you sure you want to quit?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',
});
