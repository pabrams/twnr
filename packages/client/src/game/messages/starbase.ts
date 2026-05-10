/**
 * Starbase: root prompt, Hardware Store, Shipyards, Class-0 equipment shop.
 */

import { makeDomain } from './_domain.js';

export const STARBASE = makeDomain('STARBASE', {
    rootPrompt:
        '\r\n[mg]<[/mg][bc]Starbase[/bc][mg]>[/mg] [mg]Where to?[/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] ',

    hardwarePrompt:
        '\r\n[mg]<[/mg][bc]Starbase Hardware[/bc][mg]>[/mg] [mg]What do you need[/mg] [mg]([/mg][by]?[/by][mg])[/mg][mg]?[/mg] ',
    hardwareItemRow: '  [mg]<[/mg][g]{key}[/g][mg]>[/mg]  [c]{label}[/c] [y]{price}[/y]',
    hardwareLoading: '\r\n[w]Loading hardware catalog...[/w]',
    hardwareCredits: '\r\n[mg]Credits[/mg] [by]:[/by] [bc]{credits}[/bc]',
    hardwareItemDetail:
        '\r\n[c]{label}[/c]  [g]price[/g] [by]{price}[/by]  [g]on board[/g] [bc]{current}[/bc][g]/[/g][c]{max}[/c]  [g]can buy[/g] [by]{canBuy}[/by]',

    buyQtyPrompt: '\r\n[c]How many {item}?[/c] [mg][[/mg][bc]{canBuy}[/bc][mg]][/mg] ',

    shipyardsPrompt:
        '\r\n[mg]<[/mg][bc]Shipyards[/bc][mg]>[/mg] [mg]What do you need[/mg] [mg]([/mg][by]?[/by][mg])[/mg][mg]?[/mg] ',
    shipyardsBuyHeader: '[bc]=== Shipyards - Buy ===[/bc]',
    shipyardsBuyRow: '  [by]{letter}[/by]  [w]{name}[/w] [by]{price}[/by] cr{current}',
    shipyardsBuyCurrent: ' [bg](current)[/bg]',
    shipyardsBuyPrompt:
        '\r\n[mg]<[/mg][bc]Shipyards Buy[/bc][mg]>[/mg] [mg]([/mg][by]?[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
    shipyardsExamineHeader: '[bc]=== Shipyards - {label} ===[/bc]',
    shipyardsExamineRow: '  [by]{letter}[/by]  [w]{name}[/w]',

    loadingShipCatalog: '\r\n[c]Loading ship catalog...[/c]',
    shipCatalogFailed: '[br]Failed to load ship catalog.[/br]',

    tradeinHeader: '{ship} [g]:[/g] [by]{price}[/by] cr',
    tradeinCredit: '[mg]Trade-in credit[/mg]: [by]{credit}[/by] cr',
    tradeinNet: '[by]Net cost with trade-in[/by]: [w]{net}[/w] cr',
    tradeinConfirm:
        '\r\n[c]Trade in your current ship?[/c] [mg]([/mg][by]Y[/by]/[by]N[/by]/[by]Q[/by]uit[mg])[/mg] ',

    class0EquipmentPrompt: '\r\n[mg]<[/mg][bc]Shipyards Equipment[/bc][mg]>[/mg] ',
});
