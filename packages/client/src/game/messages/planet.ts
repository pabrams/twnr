/**
 * Planet menus: landing, Earth, take/leave colonists, commodity selection.
 */

import { makeDomain } from './_domain.js';

export const PLANET = makeDomain('PLANET', {
    landing: '[bg]Landing on[/bg] [bc]{name}[/bc][by]...[/by]',
    colonists: '  [by]Colonists[/by]: [bg]{count}[/bg]',

    prompt: '\r\n[mg]Planet command[/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]:[/by] ',

    earthHeader:
        '[mg]There are [/bg] [by]{count}[/by] colonists waiting on earth to colonize distant planets.\r\n' +
        "You can repurpose your ship's storage to house 1 colonist per cargo hold.",

    takePrompt:
        '\r\n[mg]How many colonists to take?[/mg] ([/mg][bc]{emptyHolds}[/bc] [g]free holds[/g][mg]) [[/mg][by]{emptyHolds}[/by][mg]][/mg] [by]:[/by] ',
    leavePrompt:
        '\r\n[by]How many colonists to leave?[/by] [mg]([/mg][bc]{shipColonists}[/bc] [g]on board[/g][mg])[/mg] [mg][[/mg][bc]{shipColonists}[/bc][mg]][/mg] ',

    takeCommodityHeader: '[bc]Which colonists to take?[/bc]',
    leaveCommodityHeader: '[bc]Assign colonists to which commodity?[/bc]',
    commodityPrompt:
        '\r\n[mg]Choose[/mg] [mg]([/mg][by]F[/by]/[by]O[/by]/[by]E[/by]/[by]D[/by]/[by]Q[/by][mg])[/mg] [by]?[/by] ',
    takeStockpileHeader: '[bc]Which commodity to take from the planet?[/bc]',
    leaveStockpileHeader: '[bc]Which commodity to leave on the planet?[/bc]',
    takeStockpileQtyPrompt:
        '\r\n[mg]How many[/mg] [bc]{commodity}[/bc] [mg]to take?[/mg] [mg][[/mg][by]-1[/by]=[g]max[/g][mg]][/mg] [by]:[/by] ',
    leaveStockpileQtyPrompt:
        '\r\n[mg]How many[/mg] [bc]{commodity}[/bc] [mg]to leave?[/mg] [mg][[/mg][by]-1[/by]=[g]all[/g][mg]][/mg] [by]:[/by] ',
    takeStockpileResult:
        '[bg]Took [bc]{qty}[/bc] {commodity}.[/bg]  [g]Planet[/g]: [by]{planet}[/by]  [g]Ship[/g]: [by]{ship}[/by]',
    leaveStockpileResult:
        '[bg]Left [bc]{qty}[/bc] {commodity}.[/bg]  [g]Planet[/g]: [by]{planet}[/by]  [g]Ship[/g]: [by]{ship}[/by]',

    planetSelectHeader: '[bc]=== Select a Planet ===[/bc]',
    planetSelectRow: '  [by]{n}[/by]  [w]{name}[/w] ({type})',
    planetSelectPrompt:
        '\r\n[mg]Pick planet[/mg] [mg]([/mg][by]#[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
});
