/**
 * Starbase: root prompt, Hardware Store, Shipyards, Class-0 equipment shop.
 */

export const STARBASE = {
    rootPrompt:
        '\r\n[mg]<[/mg][bc]Starbase[/bc][mg]>[/mg] [mg]Where to?[/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] ',

    hardwarePrompt:
        '\r\n[mg]<[/mg][bc]Starbase Hardware[/bc][mg]>[/mg] [mg]What do you need[/mg] [mg]([/mg][by]?[/by][mg])[/mg][mg]?[/mg] ',
    hardwareItemRow: '  [c]{key}[/c]  {label} [w]{price}[/w]',
    hardwareLoading: '\r\n[w]Loading hardware catalog...[/w]',

    buyQtyPrompt: '\r\n[c]How many {item}?[/c] ',

    planetSelectHeader: '[bc]=== Select a Planet ===[/bc]',
    planetSelectRow: '  [by]{n}[/by]  [w]{name}[/w] ({type})',

    shipyardsPrompt:
        '\r\n[mg]<[/mg][bc]Shipyards[/bc][mg]>[/mg] [mg]What do you need[/mg] [mg]([/mg][by]?[/by][mg])[/mg][mg]?[/mg] ',
    shipyardsBuyHeader: '[bc]=== Shipyards - Buy ===[/bc]',
    shipyardsBuyRow: '  [by]{letter}[/by]  [w]{name}[/w] [by]{price}[/by] cr{current}',
    shipyardsBuyCurrent: ' [bg](current)[/bg]',
    shipyardsExamineHeader: '[bc]=== Shipyards - {label} ===[/bc]',
    shipyardsExamineRow: '  [by]{letter}[/by]  [w]{name}[/w]',

    loadingShipCatalog: '\r\n[w]Loading ship catalog...[/w]',
    shipCatalogFailed: '[br]Failed to load ship catalog.[/br]',

    tradeinHeader: '[bc]{ship}[/bc] — [by]Price[/by]: [w]{price}[/w] cr',
    tradeinCredit: '[by]Trade-in credit[/by]: [w]{credit}[/w] cr',
    tradeinNet: '[by]Net cost with trade-in[/by]: [w]{net}[/w] cr',
    tradeinConfirm:
        '\r\n[c]Trade in your current ship?[/c] [mg]([/mg][by]Y[/by]/[by]N[/by]/[by]Q[/by]uit[mg])[/mg] ',

    class0EquipmentPrompt:
        '\r\n[mg]<[/mg][bc]Shipyards Equipment[/bc][mg]>[/mg] ',
} as const;
