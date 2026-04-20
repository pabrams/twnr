/**
 * Main command-help screen.
 */

import { makeDomain } from './_domain.js';

export const HELP = makeDomain('HELP', {
    header: '[mg]       Sector Commands[/mg]\r\n' + 
            '[by]       =[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=',
    lineText: '[c]{label}:[/c] {text}',
    lineKey: "   [mg]<[/mg][g]{key}[/g][mg]>[/mg] [bc]{text}[/bc]",
    footer: '\r\n   [by]Move to a Sector by typing its number, and hitting Enter.[/by]\r\n' +
            '   [by]Use [mg]<[/mg][g]ENTER[/g][mg]>[/mg] to re-display the sector.[/by]\r\n',
});

export const HELP_LINES: Array<
    { label: string; text: string } | { label: string; key: string; text: string }
> = [
    { label: 'Port', key: 'P', text: 'Port and Trade' },
    { label: 'Info', key: 'I', text: 'Ship Information' },
    { label: 'Attack', key: 'A', text: 'Attack Enemy Ship' },
    { label: 'Jettison', key: 'J', text: 'Jettison Cargo.' },
    { label: 'Drones', key: 'D', text: 'Drone Deployment' },
    { label: 'Deployed', key: 'G', text: 'Show Deployed Drones' },
    { label: 'Land', key: 'L', text: 'Land on a Planet.' },
    { label: 'Terraform', key: 'U', text: 'Use Terraform Device.' },
    { label: 'Computer', key: 'C', text: 'ship computer.' },
    { label: 'Starbase', key: 'V', text: 'View Starbase Location.' },
    { label: 'Who', key: '#', text: 'Who\'s Playing' },
    { label: 'Quit', key: 'Q', text: 'Quit and Exit' },
];
