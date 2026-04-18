/**
 * Port menu, commerce report, trade prompts, Class-0 (Supply Depot) shop.
 */

import { makeDomain } from './_domain.js';

export const PORT = makeDomain('PORT', {
    menuHeader:
        '[bc]{name}[/bc][by],[/by] [mg]Class[/mg] [bc]{class}[/bc] [mg]([/mg]{label}[mg])[/mg]',
    menuNoPort: '\r\n[br]No port in this sector.[/br]',

    classLabel0: '[bc]Special[/bc]',
    classLabel1: '[g]B[/g][g]B[/g][bc]S[/bc]',
    classLabel2: '[g]B[/g][bc]S[/bc][g]B[/g]',
    classLabel3: '[bc]S[/bc][g]B[/g][g]B[/g]',
    classLabel4: '[bc]S[/bc][bc]S[/bc][g]B[/g]',
    classLabel5: '[g]B[/g][bc]S[/bc][bc]S[/bc]',
    classLabel6: '[bc]S[/bc][g]B[/g][bc]S[/bc]',
    classLabel7: '[bc]S[/bc][bc]S[/bc][bc]S[/bc]',
    classLabel8: '[g]B[/g][g]B[/g][g]B[/g]',
    classLabel9: '[bc]Special[/bc]',
    classLabelUnknown: '[br]???[/br]',

    commerceHeader: '[bg]Commerce report for[/bg] [bc]{name}[/bc]',
    commerceColumns: ' [g]{items}{status}{trading} {pct} {onBoard}[/g]',
    commerceDividers: ' [mg]{items}{status}{trading} {pct} {onBoard}[/mg]',
    commerceRowBuying:
        ' [bc]{name}[/bc][g]{status}[/g][bc]{trading}[/bc] [g]{pct}[br]%[/br][/g] [c]{onBoard}[/c]',
    commerceRowSelling:
        ' [bc]{name}[/bc][g]{status}[/g][bc]{trading}[/bc] [g]{pct}[br]%[/br][/g] [c]{onBoard}[/c]',
    commerceFooter:
        '[mg]You have[/mg] [by]{credits}[/by] [mg]credits and[/mg] [by]{holds}[/by] [mg]empty cargo holds.[/mg]',

    noTrade: "[bc]You don't have anything they want, and they don't have anything you need.[/bc]",
    skipInsufficientTurns: '[br]Insufficient turns.[/br]',
    skipInsufficientCredits: '[br]Insufficient credits.[/br]',
    skipInsufficientPortInventory: '[br]Insufficient port inventory.[/br]',
    skipInsufficientCargoHolds: '[br]Insufficient cargo holds.[/br]',
    skipInsufficientCargo: '[br]Insufficient cargo.[/br]',
    skipPortCannotBuy: '[br]Port cannot buy that many.[/br]',

    tradeQtyInfoBuy:
        '[mg]We are[/mg] [bc]selling[/bc] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyInfoSell:
        '[mg]We are[/mg] [g]buying[/g] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyPromptBuy:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to buy [[/mg][by]{maxQty}[/by][mg]]?[/mg] ',
    tradeQtyPromptSell:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to sell [[/mg][by]{maxQty}[/by][mg]]?[/mg] ',

    class0DockHeader: '[bg]Docked[/bg] at [bc]Starbase Supply Depot[/bc]',
    class0Drones: '[w]({price} credits each)[/w]',
    class0Shields: '[w]({price} credits each)[/w]',
    class0Holds: '[w]({price} credits each)[/w]',
});
