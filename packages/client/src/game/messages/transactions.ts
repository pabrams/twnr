/**
 * Purchase, trade, and ship-exchange results.
 */

import { makeDomain } from './_domain.js';

export const TRANSACTION = makeDomain('TRANSACTION', {
    tradeComplete: '\r\n[bg]Transaction complete.[/bg] [mg]Credits:[/mg] [by]{credits}[/by]',
    tradeConfirmSell: "\r\n[mg]We'll sell them for[/mg] [by]{total}[/by] [mg]credits.[/mg]",
    tradeConfirmBuy: "\r\n[mg]We'll buy them for[/mg] [by]{total}[/by] [mg]credits.[/mg]",
    tradeConfirmAccept:
        '[mg]Accept?[/mg] [mg]([/mg][by]y[/by][mg]/[/mg][by]n[/by][mg])[/mg] [mg][[/mg][by]Y[/by][mg]][/mg] ',

    purchaseComplete: '\r\n[bg]Purchase complete.[/bg]',
    purchaseStatsDrones: '  [by]Credits[/by]: {credits}  [by]Drones[/by]: {drones}',
    purchaseStatsShields: '  [by]Credits[/by]: {credits}  [by]Shields[/by]: {shields}',
    purchaseStatsHolds: '  [by]Credits[/by]: {credits}  [by]Holds[/by]: {holds}',

    shipExchanged: '\r\n[bg]Ship exchanged![/bg] Now flying: [bc]{name}[/bc]',
    shipPurchased: '\r\n[bg]New ship purchased![/bg] Now flying: [bc]{name}[/bc]',
    shipCreditsLine: '  [by]Credits[/by]: {credits}',

    hardwareInstalled: '\r\n[bg]{label} installed![/bg] Credits: {credits}',
    hardwareStacked: '\r\n[bg]Purchase complete.[/bg]\r\n' +
                     '[mg]{label}: [by]{total}[/by], Credits: [by]{credits}[/by]',

    undocked: '\r\n[w]You undock from the port.[/w]',

    jettisoned: '\r\n[by]Jettisoned:[/by] {items}',
});
