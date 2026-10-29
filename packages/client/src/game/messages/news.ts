import type { GameEventKind } from '@twnr/shared';
import { makeDomain } from './_domain.js';

export const NEWS = makeDomain('NEWS', {
    connectPrompt:
        "\r\n[by]Display today's Galactic News?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ",
    dateIntro:
        '\r\n[g]Enter the beginning date you wish to read from. Today is  [/g][bc]{today}[/bc][g],[/g]\r\n' +
        '[g]and the earliest date available is [/g][bc]{earliest}[/bc][g]. Use the format YYYY/MM/DD.[/g]',
    datePrompt: '[by]Input search date[/by] [mg][[/mg][bc]{today}[/bc][mg]][/mg][by]:[/by] ',
    dateInvalid:
        '[br]Enter a date between {earliest} and {today} as YYYY/MM/DD (Q to cancel).[/br]',
    noNewsYet: '\r\n[g]The Galactic News has nothing to report yet.[/g]',
    dayHeader:
        '   [mg]-=-=-=-=-=-=-=-[/mg] [by]Galactic News, Stardate {date}[/by] [mg]-=-=-=-=-=-=-=-[/mg]',
    pausePrompt: '[mg](Paused - <[/mg][by]C[/by][mg]> to cancel, any other key to continue)[/mg]',

    clanLabel: '[mg]#[/mg][bc]{clanNumber}[/bc] [by]{name}[/by]',
    ownerRogue: '[g]no one[/g]',
    defenseDrones: 'drones',
    defenseMines: 'mines',
});

/** One template per game event kind; keys are the kinds themselves. */
export const NEWS_EVENT = makeDomain('NEWS_EVENT', {
    player_ship_destroyed_by_ship_combat:
        "[bc]{attacker}[/bc] destroyed [bc]{victim}[/bc]'s {shipType}!",
    player_ship_destroyed_by_sector_defenses:
        "[bc]{victim}[/bc]'s {shipType} was destroyed by {defense} belonging to {owner}!",
    planet_collision:
        '[bc]{planet}[/bc] collided with [bc]{collidingWith}[/bc] in sector [by]{sector}[/by]!',
    planet_destroyed: '[bc]{destroyer}[/bc] destroyed planet [bc]{planet}[/bc]!',
    player_joined_universe: '[bc]{player}[/bc] has entered the galaxy.',
    player_issued_ship: '[bc]{player}[/bc] has been supplied a new {shipType}.',
    clan_created: '[bc]{founder}[/bc] started a new clan {clan}.',
    player_joined_clan: '[bc]{player}[/bc] has joined clan {clan}.',
    player_left_clan: '[bc]{player}[/bc] has left clan {clan}.',
    player_kicked_from_clan: '[bc]{player}[/bc] has been kicked out of clan {clan}.',
    clan_disbanded: '{clan} has been disbanded.',
    planet_claimed: '[bc]{planet}[/bc] has been claimed by {owner}.',
    port_built: 'A new port has opened in sector [by]{sector}[/by].',
    base_upgraded:
        '[bc]{planet}[/bc] has completed construction of a level [by]{level}[/by] planetary bastion.',
} satisfies Record<GameEventKind, string>);
