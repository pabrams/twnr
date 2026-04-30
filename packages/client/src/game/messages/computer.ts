/**
 * Ship computer: prompts, known-universe, ship catalog, ship/planet detail,
 * trader list.
 */

import { makeDomain } from './_domain.js';

export const COMPUTER = makeDomain('COMPUTER', {
    prompt: '\r\n[mg]Computer command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by][br]=[/br][by]Help[/by][mg])[/mg] [by]:[/by] ',

    activated: '\r\n[bc]<Computer activated>[/bc]',
    deactivated: '\r\n[bc]<Computer deactivated>[/bc]',

    knownUniversePrompt:
        '\r\n[bc]Known Universe[/bc] — [by]E[/by]xplored, [by]U[/by]nexplored, [by]Q[/by]uit? ',

    exploredHeader: '[bc]Explored sectors[/bc] ({count}):',
    exploredSector: '[bc]{n}[/bc]',
    unexploredHeader: '[bc]Unexplored sectors[/bc] ({count}):',
    unexploredSector: '[br]{n}[/br]',

    shipCatalogHeader: '[bc]=== Ship Catalog ===[/bc]',
    shipCatalogRow: '  [mg]<[/mg][by]{letter}[/by][mg]>[/mg]  [g]{name}[/g]',

    shipDetailHeader: '[bc]{name}[/bc]',
    shipDetailLine: '  [g]{label}[/g] [bc]{value}[/bc]',
    shipDetailBoolYes: '[bc]Yes[/bc]',
    shipDetailBoolNo: '[bc]No[/bc]',
    shipDetailRow: '  {row}',
    shipDetailColon: '[by]:[/by] ',
    shipInterestPrompt:
        '\r\n[mg]Which ship are you interested in ([/mg][by]?[/by][mg]=List, [/mg][by]Q[/by][mg]=Quit) [/mg][by]?[/by] ',

    planetSpecsHeader: '[bc]=== Planetary Specifications ===[/bc]',
    planetSpecsRow: '  [mg]<[/mg][by]{letter}[/by][mg]>[/mg]  [g]{type}[/g]',
    planetSpecsPrompt:
        '\r\n[mg]Planet specs[/mg] [mg]([/mg][by]?[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
    planetDetailHeader: '[bc]=== {type} ===[/bc]',
    planetDetailDescription: '  [w]{description}[/w]',
    planetDetailLine: '  [by]{label}[/by] [w]{value}[/w]',

    planetSpecsLoading: '\r\n[w]Loading planetary specs...[/w]',
    planetSpecsFailed: '[br]Failed to load planetary specs.[/br]',

    traderListLoading: '\r\n[w]Loading traders...[/w]',
    traderListHeader: '[bc]=== Traders in Universe ===[/bc]',
    traderListColumns: '  [bw]{name}[/bw] [bw]Ship[/bw]',
    traderListRow: '  [by]{name}[/by] [w]{ship}[/w]',
    traderListShipDestroyed: '[bb]### [y]SHIP DESTROYED[/y] ###[/bb]',
    traderListFailed: '[br]Failed to load trader list.[/br]',

    shipDataRequesting: '[w]Requesting ship data...[/w]',
    shipConfigNotFound: '[br]Ship config not found for: {name}[/br]',
});
