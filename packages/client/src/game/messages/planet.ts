/**
 * Planet menus: landing, Earth, take/leave colonists, commodity selection.
 */

import { makeDomain } from './_domain.js';

export const PLANET = makeDomain('PLANET', {
    landing: '[bg]Landing on[/bg] [bc]{name}[/bc][by]...[/by]',
    colonists: '  [by]Colonists[/by]: [w]{count}[/w]',

    prompt: '\r\n[mg]Planet command[/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]?[/by] ',

    earthHeader: '[bg]Earth[/bg] — [by]Colonists[/by]: [w]{count}[/w]',

    takePrompt: '\r\n[c]How many colonists to take?[/c] ',
    leavePrompt: '\r\n[c]How many colonists to leave?[/c] ',

    takeCommodityHeader: '[bc]Which colonists to take?[/bc]',
    leaveCommodityHeader: '[bc]Assign colonists to which commodity?[/bc]',
});
