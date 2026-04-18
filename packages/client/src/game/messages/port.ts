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
        ' [bw]{items}[/bw][bw]{status}[/bw][bw]{trading}[/bw] [bw]{pct}[/bw] [bw]{onBoard}[/bw]',
    commerceDividers:
        ' [w]{items}[/w][w]{status}[/w][w]{trading}[/w] [w]{pct}[/w] [w]{onBoard}[/w]',
    commerceRowBuying:
        ' [by]{name}[/by][bg]{status}[/bg][w]{trading}[/w] [w]{pct}[/w] [w]{onBoard}[/w]',
    commerceRowSelling:
        ' [by]{name}[/by][br]{status}[/br][w]{trading}[/w] [w]{pct}[/w] [w]{onBoard}[/w]',
    commerceFooter:
        '[mg]You have[/mg] [by]{credits}[/by] [mg]credits and[/mg] [by]{holds}[/by] [mg]empty cargo holds.[/mg]',

    noTrade:
        '[w]You don\'t have anything they want, and they don\'t have anything you need.[/w]',

    tradeQtyInfoBuy:
        '[mg]We are[/mg] [br]selling[/br] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyInfoSell:
        '[mg]We are[/mg] [bg]buying[/bg] [mg]up to[/mg] [by]{portTrading}[/by][mg].[/mg] [mg]You have[/mg] [by]{onBoard}[/by] [mg]in your holds.[/mg]',
    tradeQtyPromptBuy:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to[/mg] [br]buy[/br] [mg][[/mg][by]{maxQty}[/by][mg]]?[/mg] ',
    tradeQtyPromptSell:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to[/mg] [bg]sell[/bg] [mg][[/mg][by]{maxQty}[/by][mg]]?[/mg] ',

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
