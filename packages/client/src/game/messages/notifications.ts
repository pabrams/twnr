/**
 * Short user-facing notifications — connect/disconnect, welcomes,
 * simple "invalid input" messages.
 */

import { makeDomain } from './_domain.js';

export const NOTIFY = makeDomain('NOTIFY', {
    connected: '[g]Connected to TWNR.[/g]',
    connectionError: '\r\n[br]Connection error.[/br]',

    welcome: '\r\n[bg]Welcome, {name}.[/bg]',
    goodbye: '\r\n[w]Goodbye![/w]',

    playerIn: '\r\n[by]Player warped into the sector.[/by]',
    playerOut: '\r\n[w]Player warped out of the sector.[/w]',

    starbaseLocation: '\r\n[bc]Starbase[/bc] [g]is in sector[/g] [bc]{sector}[/bc]',
    noStarbase: '\r\n[w]No Starbase in this universe.[/w]',

    error: '\r\n[br]Error:[/br] [r]{message}[/r]',
    invalidSelection: '[br]Invalid selection.[/br]',

    unknownCommand: 'Unknown command: {cmd}',

    autopilotEngaged: '\r\n[g:bb]<Autopilot engaging>[/g:bb]',
    noPreviousSector: '\r\n[w]No previous sector to return to.[/w]',
});
