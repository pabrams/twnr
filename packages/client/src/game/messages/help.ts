/**
 * Main command-help screen.
 */

import { makeDomain } from './_domain.js';

export const HELP = makeDomain('HELP', {
    header: '[by]Move to a Sector by typing its number, and hitting Enter.[/by]\r\n' + 
            '[by]Use [g]CR[/g] to re-display the sector.[/by]\r\n',
    lineText: '[c]{label}:[/c] {text}',
    lineKey: "   [mg]<[/mg][g]{key}[/g][mg]>[/mg] [bc]{text}[/bc]",
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
