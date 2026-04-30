/**
 * Short user-facing notifications — connect/disconnect, welcomes,
 * simple "invalid input" messages.
 */

import { makeDomain } from './_domain.js';

export const NOTIFY = makeDomain('NOTIFY', {
    connected: '[g]Connected to TWNR.[/g]',
    connectionError: '\r\n[br]Connection error.[/br]',

    welcome: '\r\n[bg]Welcome, {name}.[/bg]',
    welcomeGuest:
        '\r\n[by]*** Guest demo account ***[/by]' +
        '\r\n[y]This account and its progress will be deleted when you log out or disconnect.[/y]' +
        '\r\n[y]Register an email account to keep your progress.[/y]',
    goodbye: '\r\n[w]Disconnecting...[/w]',

    playerIn: '\r\n[by][bm]{name}[/bm] warped into the sector.[/by]',
    playerOut: '\r\n[y][bm]{name}[/bm] warped out of the sector.[/y]',

    starbaseLocation:
        '\r\n[br]***[/br] [bc]Starbase[/bc] [g]is in sector[/g] [by]{sector}[/by] [br]***[/br] ',
    noStarbase: '\r\n[w]No Starbase in this universe.[/w]',

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

    autopilotEngaged: '\r\n[bg:b]<Autopilot engaging>[/bg:b]',
    noPreviousSector: '\r\n[w]No previous sector to return to.[/w]',
    quitConfirm:
        '\r\n[by]Are you sure you want to quit?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',
    terraformDevicesAvailable: '\r\n[g]You have[/g] [bc]{count}[/bc] [g]Terraform Devices.[/g]',
    terraformConfirm:
        '[by]Terraform this sector?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',
    terraformNoDevices: '\r\n[bg]You have no Terraform Devices.[/bg]',
});
