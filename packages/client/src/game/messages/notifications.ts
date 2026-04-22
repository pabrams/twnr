/**
 * Short user-facing notifications — connect/disconnect, welcomes,
 * simple "invalid input" messages.
 */

import { makeDomain } from './_domain.js';

export const NOTIFY = makeDomain('NOTIFY', {
    connected: '[g]Connected to TWNR.[/g]',
    connectionError: '\r\n[br]Connection error.[/br]',

    welcome: '\r\n[bg]Welcome, {name}.[/bg]',
    goodbye: '\r\n[w]Disconnecting...[/w]',

    playerIn: '\r\n[by][bm]{name}[/bm] warped into the sector.[/by]',
    playerOut: '\r\n[y][bm]{name}[/bm] warped out of the sector.[/y]',

    starbaseLocation: '\r\n[bc]Starbase[/bc] [g]is in sector[/g] [by]{sector}[/by].',
    noStarbase: '\r\n[w]No Starbase in this universe.[/w]',

    error: '\r\n[r]{message}[/r]',
    invalidSelection: '[br]Invalid selection.[/br]',

    unknownCommand: 'Unknown command: {cmd}',

    autopilotEngaged: '\r\n[g:bb]<Autopilot engaging>[/g:bb]',
    noPreviousSector: '\r\n[w]No previous sector to return to.[/w]',
    quitConfirm:
        '\r\n[by]Are you sure you want to quit?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',
    terraformDevicesAvailable: '\r\n[g]You have[/g] [bc]{count}[/bc] [g]Terraform Devices.[/g]',
    terraformConfirm:
        '[by]Terraform this sector?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',
    terraformNoDevices: '\r\n[w]You have no Terraform Devices.[/w]',
});
