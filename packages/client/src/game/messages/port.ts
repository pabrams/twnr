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

    haggleAgreed: '[g]Agreed,[/g] [by]{qty}[/by] [g]units.[/g]',
    haggleOfferBuy: "[mg]We'll sell them for[/mg] [by]{offer}[/by] [mg]credits.[/mg]",
    haggleOfferSell: "[mg]We'll buy them for[/mg] [by]{offer}[/by] [mg]credits.[/mg]",
    haggleYourOffer: '[mg]Your offer [[/mg][by]{current}[/by][mg]] ?[/mg] ',
    haggleWalkAway: '[y]You walk away from the deal.[/y]',
    haggleAccepted: "[bg]You are a shrewd trader, they're all yours.[/bg]",
    haggleFinalOffer: '[br]Our final offer is[/br] [by]{offer}[/by] [br]credits.[/br]',
    haggleRejected: '[br]This conversation is terminated![/br]',
    haggleError: '[br]Haggle error[/br]',

    constructNoPlanet: '[y]You need a planet in this sector before you can construct a port.[/y]',
    constructTitle: '   [bc]StarPort Construction          Initial Construction Costs[/bc]',
    constructColumns: ' [bw]Port Class   Ore  Org  Equ    Credits  Ore  Org  Equ  Days[/bw]',
    constructRule: ' [g]---------- - --- --- ----   --------- ---- ---- ---- ----[/g]',
    constructRow:
        '     [bc]{portClass}[/bc]      {code}   [by]{credits}[/by] {ore} {org} {equ} {days}',
    constructProduces:
        '[mg]Ports will initially produce[/mg] [by]{rate}[/by] [mg]units/day in each category[/mg]',
    youHaveCredits: '[mg]You have[/mg] [by]{credits}[/by] [mg]credits.[/mg]',
    constructUnderway:
        '[y]Note: construction of "[/y][bc]{name}[/bc][y]" (Class [/y][bc]{class}[/bc][y]) is already underway here — [/y][bc]{done}[/bc][y]/[/y][bc]{total}[/bc][y] days complete.[/y]',
    constructClassPrompt: '[mg]What Class of port do you want to build? (1-8, Q to quit)[/mg] ',
    constructClassCost:
        '[mg]Port Class[/mg] [bc]{class}[/bc] [mg]will require[/mg] [by]{credits}[/by] [mg]credits.[/mg]',
    constructPlanetProduces: '[mg]A Planet capable of producing the following per day:[/mg]',
    constructDailyRow:
        '[by]{qty}[/by] [mg]units of {commodity}/day for[/mg] [by]{days}[/by] [mg]days[/mg]',
    constructConfirmPrompt: '[mg]Do you want to initiate construction on this port?[/mg] ',
    constructNamePrompt: '[by]What do you want to name this StarPort?[/by]',
    upgradeTag: '[bg](Upgrade StarPort)[/bg]',
    upgradeTitle: '   [bc]Upgrade Starport Production[/bc]',
    upgradeRow:
        ' [bc]{i}[/bc] {label} [mg]costs[/mg] [by]${cost}[/by][mg]/unit   ({action}, prod={prod}, max={max}, stock={stock}, {pct}%)[/mg]',
    upgradeChoosePrompt: '[mg]Choose 1, 2, 3 or Q to quit[/mg] ',
    upgradeInsufficient:
        '[br]Insufficient credits to upgrade {label} (need at least ${cost}).[/br]',
    upgradeCostPerUnit:
        '[mg]That will cost[/mg] [by]{cost}[/by] [mg]per unit to upgrade the[/mg] [bc]{label}[/bc]',
    upgradeUnitsPrompt:
        '[mg]How many units do you want to invest? ([/mg][by]{max}[/by] [mg]max, 0 to quit)[/mg] ',

    buildExpGained: 'For building this Starport, you receive {exp} experience point(s).',
    buildAlignmentUp: 'and your alignment went up by {rep} point(s).',
    buildUnderway:
        'Construction underway. Daily advances will be reported by mail ({days} days total).',
    upgradeExpGained: 'For upgrading this StarPort, you receive {exp} experience point(s).',
    upgradeComplete: 'StarPort upgraded!',
});
