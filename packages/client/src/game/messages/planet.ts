/**
 * Planet menus: landing, Earth, take/leave colonists, commodity selection.
 */

import { makeDomain } from './_domain.js';

export const PLANET = makeDomain('PLANET', {
    landing: '[bg]Landing on[/bg] [bc]{name}[/bc][by]...[/by]',
    colonists: '  [by]Colonists[/by]: [bg]{count}[/bg]',

    prompt: '\r\n[mg]Planet command[/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]?[/by] ',

    earthHeader: '[bg]Earth[/bg] — [by]Colonists[/by]: [w]{count}[/w]',

    takePrompt: '\r\n[by]How many colonists to take?[/by] ',
    leavePrompt: '\r\n[by]How many colonists to leave?[/by] ',

    takeCommodityHeader: '[bc]Which colonists to take?[/bc]',
    leaveCommodityHeader: '[bc]Assign colonists to which commodity?[/bc]',
});
