/**
 * Planet domain: landing, Earth, take/leave colonists, commodity selection,
 * planet-detail display, owned-planet list.
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
        '\r\n[mg]How many[/mg] [bc]{commodity}[/bc] [mg]to take?[/mg] [mg][[/mg][by]{default}[/by][mg]][/mg] [by]:[/by] ',
    leaveStockpileQtyPrompt:
        '\r\n[mg]How many[/mg] [bc]{commodity}[/bc] [mg]to leave?[/mg] [mg][[/mg][by]{default}[/by][mg]][/mg] [by]:[/by] ',
    takeStockpileResult:
        '[bg]Took [bc]{qty}[/bc] {commodity}.[/bg]  [g]Planet[/g]: [by]{planet}[/by]  [g]Ship[/g]: [by]{ship}[/by]',
    leaveStockpileResult:
        '[bg]Left [bc]{qty}[/bc] {commodity}.[/bg]  [g]Planet[/g]: [by]{planet}[/by]  [g]Ship[/g]: [by]{ship}[/by]',

    planetSelectHeader: '[by]Registry# Planet Name[/by]',
    planetSelectSep: '[g]-----------------------------------------------[/g]',
    planetSelectRow: '   [mg]<[/mg][by]{n}[/by][mg]>[/mg]  [bc]{name}[/bc]',
    planetSelectPrompt:
        '\r\n[mg]Land on which planet[/mg] [mg]<[/mg][by]Q[/by] [mg]to abort> ?[/mg] ',

    takeColonistsHeader: '[bg]You took [bc]{qty}[/bc] colonists.[/bg]',
    leaveColonistsHeader: '[bg]You left [bc]{qty}[/bc] colonists.[/bg]',
    planetColonistsLine: '  [g]There are [by]{count}[/by] colonists remaining on the planet.[/g]',
    shipColonistsLine:
        '  [g]Your holds  [by]{count}[/by] holds occupied by camping colonists.[/g]: ',

    landedHeader: '[bg]Landed on[/bg] [bc]{name}[/bc]',

    displayTitle: '[bc]Planet #{id}[/bc] in sector [by]{sector}[/by]:  [bg]{name}[/bg]',
    displayClass: '[mg]Class[/mg]: {type}',
    displayOwner: '[mg]Owner[/mg]: [w]{owner}[/w]',
    displayTableHead1:
        '  [by]Item[/by]    [by]Colonists[/by]   [by]Colos to[/by]   [by]Hourly[/by]     [by]Planet[/by]     [by]Ship[/by]       [by]Planet[/by]',
    displayTableHead2:
        '                      [by]Build 1/h[/by]  [by]Product[/by]    [by]Amount[/by]     [by]Amount[/by]     [by]Maximum[/by]',
    displayTableSep:
        ' [g]-------- ----------  ---------  ---------  ---------  --------- ---------[/g]',
    displayTableRow:
        '[w]{item}[/w]  [bc]{colos}[/bc]  [c]{c2b1}[/c]  [bc]{hourly}[/bc]  [bc]{planet}[/bc]  [bc]{ship}[/bc]  [c]{max}[/c]',
    displayHolds: '\r\n[g]You have[/g] [bc]{holds}[/bc] [g]free cargo holds.[/g]',

    listEmpty: '[br]You own no planets.[/br]',
    listHeader: '[bc]=== Your Planets ===[/bc]',
    listRow: '  [by]Sector {sector}[/by] — [bc]{name}[/bc] ({type})',
    listColonists:
        '  Colonists: {{MSG.fuelQuantity}}, {{MSG.orgQuantity}}, {{MSG.equQuantity}}, {{MSG.drnQuantity}}',

    claimOwnershipPrompt:
        '\r\n[mg]Claim as ([/mg][by]P[/by][mg]ersonal, [/mg][by]C[/by][mg]lan, [/mg][by]Q[/by][mg]) [/mg][by]?[/by] ',
    claimSuccessPersonal: '\r\n[bg]Planet [/bg][bc]{name}[/bc] [bg]is now yours.[/bg]',
    claimSuccessClan: '\r\n[bg]Planet [/bg][bc]{name}[/bc] [bg]is now clan-owned.[/bg]',
});
