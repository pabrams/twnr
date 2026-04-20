/**
 * Main command-help screen.
 */

import { makeDomain } from './_domain.js';

export const HELP = makeDomain('HELP', {
    header: '[mg]     Sector Commands[/mg]\r\n' + 
            '[by]     =[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=',
    lineText: '[c]{label}:[/c] {text}',
    lineKey: "   [mg]<[/mg][g]{key}[/g][mg]>[/mg] [bc]{text}[/bc]",
    footer: '\r\n[mg]     Movement[/mg]\r\n' + 
            '[by]     =[g]-[/g]=[g]-[/g][g]-[/g]=[g]-[/g]=' +
            '\r\n   [c]Move to any Sector by typing its number.[/c]\r\n' +
            '   [c]Attempting to move to a non-adjacent sector will prompt to engage auto-pilot.[/c]\r\n' +
            '   [c]Quick-move to an adjacent sector using the [mg]<[/mg][g]M[/g][mg]>[/mg] command.[/c]\r\n' +
            '   [c]Use [mg]<[/mg][g]ENTER[/g][mg]>[/mg] to re-display the sector.[/c]\r\n',
});

export const HELP_LINES: Array<
    { label: string; text: string } | { label: string; key: string; text: string }
> = [
    { label: 'Who', key: '#', text: 'Who\'s Playing' },
    { label: 'Info', key: 'I', text: 'Ship Information' },
    { label: 'Port', key: 'P', text: 'Port and Trade' },
    { label: 'Jettison', key: 'J', text: 'Jettison Cargo' },
    { label: 'Attack', key: 'A', text: 'Attack Enemy Ship' },
    { label: 'Drones', key: 'D', text: 'Drone Deployment' },
    { label: 'Deployed', key: 'G', text: 'Show Deployed Drones' },
    { label: 'Land', key: 'L', text: 'Land on a Planet' },
    { label: 'Terraform', key: 'U', text: 'Use Terraform Device' },
    { label: 'Computer', key: 'C', text: 'ship computer' },
    { label: 'Starbase', key: 'V', text: 'View Starbase Location' },
    { label: 'Quit', key: 'Q', text: 'Quit and Exit' },
];
