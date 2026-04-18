/**
 * Port menu, commerce report, trade prompts, Class-0 (Supply Depot) shop.
 */

import { makeDomain } from './_domain.js';

export const PORT = makeDomain('PORT', {
    menuHeader:
        '[bc]{name}[/bc][by],[/by] [mg]Class[/mg] [bc]{class}[/bc] [mg]([/mg][bw]{label}[/bw][mg])[/mg]',
    menuNoPort: '\r\n[br]No port in this sector.[/br]',

    commerceHeader: '[bg]Commerce report for[/bg] [bc]{name}[/bc]',
    commerceColumns:
        ' [g]{items}{status}{trading} {pct} {onBoard}[/g]',
    commerceDividers:
        ' [mg]{items}{status}{trading} {pct} {onBoard}[/mg]',
    commerceRowBuying:
        ' [bc]{name}[/bc][g]{status}[/g][bc]{trading}[/bc] [g]{pct}[br]%[/br][/g] [c]{onBoard}[/c]',
    commerceRowSelling:
        ' [bc]{name}[/bc][g]{status}[/g][bc]{trading}[/bc] [g]{pct}[br]%[/br][/g] [c]{onBoard}[/c]',
    commerceFooter:
        '[mg]You have[/mg] [by]{credits}[/by] [mg]credits and[/mg] [by]{holds}[/by] [mg]empty cargo holds.[/mg]',

    noTrade:
        '[bc]You don\'t have anything they want, and they don\'t have anything you need.[/bc]',
    skipInsufficientTurns: '[br]Insufficient turns.[/br]',
    skipInsufficientCredits: '[br]Insufficient credits.[/br]',
    skipInsufficientPortInventory: '[br]Insufficient port inventory.[/br]',
    skipInsufficientCargoHolds: '[br]Insufficient cargo holds.[/br]',
    skipInsufficientCargo: '[br]Insufficient cargo.[/br]',
    skipPortCannotBuy: '[br]Port cannot buy that many.[/br]',

    tradeQtyInfoBuy:
        '[mg]We are[/mg] [br]selling[/br] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyInfoSell:
        '[mg]We are[/mg] [bg]buying[/bg] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyPromptBuy:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to buy [[/mg][by]{maxQty}[/by][mg]]?[/mg] ',
    tradeQtyPromptSell:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to sell [[/mg][by]{maxQty}[/by][mg]]?[/mg] ',

    tradeConfirmSell:
        '\r\n[mg]We\'ll[/mg] sell [mg]them for[/mg] [by]{total}[/by] [mg]credits.[/mg]',
    tradeConfirmBuy:
        '\r\n[mg]We\'ll[/mg] buy [mg]them for[/mg] [by]{total}[/by] [mg]credits.[/mg]',
    tradeConfirmAccept:
        '[mg]Accept?[/mg] [mg]([/mg][by]Y[/by][mg]/[/mg][by]N[/by][mg])[/mg] ',

    class0DockHeader: '[bg]Docked[/bg] at [bc]Starbase Supply Depot[/bc]',
    class0Drones: '[w]({price} credits each)[/w]',
    class0Shields: '[w]({price} credits each)[/w]',
    class0Holds: '[w]({price} credits each)[/w]',
});
