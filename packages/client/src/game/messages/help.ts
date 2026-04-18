/**
 * Main command-help screen.
 */

import { makeDomain } from './_domain.js';

export const HELP = makeDomain('HELP', {
    header: '[c]Help:[/c]',
    lineText: '[c]{label}:[/c] {text}',
    lineKey: "[c]{label}:[/c] [by]'{key}'[/by] {text}",
});

export const HELP_LINES: Array<
    | { label: string; text: string }
    | { label: string; key: string; text: string }
> = [
    { label: 'Command', text: 'Move to a sector by typing its number.' },
    { label: 'Display', key: 'D', text: 'refresh sector display.' },
    { label: 'Port', key: 'P', text: 'access a port.' },
    { label: 'Info', key: 'I', text: 'view player and ship info.' },
    { label: 'Attack', key: 'A', text: 'attack a player in your sector.' },
    { label: 'Jettison', key: 'J', text: 'jettison all cargo.' },
    { label: 'Drones', key: 'F', text: 'deploy sector drones.' },
    { label: 'Deployed', key: 'G', text: 'list deployed drones.' },
    { label: 'Land', key: 'L', text: 'land on a planet.' },
    { label: 'Terraform', key: 'U', text: 'use terraform device.' },
    { label: 'Computer', key: 'C', text: 'ship computer.' },
    { label: 'Starbase', key: 'V', text: 'show Starbase location.' },
    { label: 'Who', key: '#', text: 'players online.' },
    { label: 'Help', key: '?', text: 'this help.' },
    { label: 'Quit', key: 'Q', text: 'quit the game.' },
];
