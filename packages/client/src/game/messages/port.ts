/**
 * Port menu, commerce report, trade prompts, Class-0 (Supply Depot) shop.
 */

import { makeDomain } from './_domain.js';

export const PORT = makeDomain('PORT', {
    menuHeader:
        '[bc]{name}[/bc][by],[/by] [mg]Class[/mg] [bc]{class}[/bc] [mg]([/mg]{label}[mg])[/mg]',
    menuNoPort: '\r\n[br]No port in this sector.[/br]',
    menuUnderConstruction:
        '\r\n[br]{name} is still under construction - {days} days remaining.[/br]',

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

    tradeQtyInfoBuy:
        '[mg]We are[/mg] [bc]selling[/bc] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyInfoSell:
        '[mg]We are[/mg] [g]buying[/g] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyPromptBuy:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to buy [[/mg][by]{maxQty}[/by][mg]]?[/mg] ',
    tradeQtyPromptSell:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to sell [[/mg][by]{maxQty}[/by][mg]]?[/mg] ',

    class0DockHeader: '[bg]Docked[/bg] at [bc]Starbase Supply Depot[/bc]',
    class0Drones: '[g]({price} credits each)[/g]',
    class0Shields: '[g]({price} credits each)[/g]',
    class0Holds: '[g]({price} credits each)[/g]',

    class0Docking: '\r\n[bg]Docking...[/bg]',
    class0CreditsLine: '[mg]You have[/mg] [by]{credits}[/by] [mg]credits.[/mg]',
    class0CommerceHeader:
        '[bg]Commerce report for:[/bg] [bc]{timestamp}[/bc]     [mg]You can buy:[/mg]',
    class0RowHolds:
        ' [bc]A[/bc]  [mg]Cargo holds[/mg]     [by]:[/by] [by]{price}[/by] [mg]credits / next hold[/mg]        [c]{canBuy}[/c]',
    class0RowDrones:
        ' [bc]B[/bc]  [mg]Drones[/mg]          [by]:[/by] [by]{price}[/by] [mg]credits per fighter[/mg]        [c]{canBuy}[/c]',
    class0RowShields:
        ' [bc]C[/bc]  [mg]Shield Points[/mg]   [by]:[/by] [by]{price}[/by] [mg]credits per point[/mg]          [c]{canBuy}[/c]',
    class0BuyPrompt:
        '\r\n[mg]Which item do you wish to buy?[/mg] [mg]([/mg][by]A[/by][mg],[/mg][by]B[/by][mg],[/mg][by]C[/by][mg],[/mg][by]Q[/by][mg],[/mg][by]?[/by][mg])[/mg] [by]:[/by] ',

    class0QtyYouHaveFighters: '\r\n[mg]You have[/mg] [by]{qty}[/by] [mg]drones.[/mg]',
    class0QtyYouHaveShields: '\r\n[mg]You have[/mg] [by]{qty}[/by] [mg]shield points.[/mg]',
    class0QtyYouHaveHolds: '\r\n[mg]You have[/mg] [by]{qty}[/by] [mg]cargo holds.[/mg]',
    class0QtyPromptFighters:
        '[mg]How many drones do you want to buy ([/mg][by]Max {max}[/by][mg]) [[/mg][by]{max}[/by][mg]] ?[/mg] ',
    class0QtyPromptShields:
        '[mg]How many shield points do you want to buy ([/mg][by]Max {max}[/by][mg]) [[/mg][by]{max}[/by][mg]] ?[/mg] ',
    class0QtyPromptHolds:
        '[mg]How many cargo holds do you want to buy ([/mg][by]Max {max}[/by][mg]) [[/mg][by]{max}[/by][mg]] ?[/mg] ',

    class0HelpHeader: '\r\n[bg]Class-0 Port Commands[/bg]',
    class0HelpRow: ' [bc]{key}[/bc] [mg]-[/mg] [by]{desc}[/by]',
});
