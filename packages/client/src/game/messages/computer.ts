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
        '\r\n[bc]Known Universe[/bc] — [c]E[/c]xplored, [c]U[/c]nexplored, [c]Q[/c]uit? ',

    exploredHeader: '[bc]Explored sectors[/bc] ({count}):',
    exploredSector: '[bc]{n}[/bc]',
    unexploredHeader: '[bc]Unexplored sectors[/bc] ({count}):',
    unexploredSector: '[br]{n}[/br]',

    shipCatalogHeader: '[bc]=== Ship Catalog ===[/bc]',
    shipCatalogRow: '  [by]{letter}[/by]  [w]{name}[/w]',

    shipDetailHeader: '[bc]=== {name} ===[/bc]',
    shipDetailLine: '  [by]{label}[/by] [w]{value}[/w]',
    shipDetailBoolYes: '[bg]Yes[/bg]',
    shipDetailBoolNo: '[w]No[/w]',

    planetSpecsHeader: '[bc]=== Planetary Specifications ===[/bc]',
    planetSpecsRow: '  [by]{letter}[/by]  [w]{type}[/w]',
    planetDetailHeader: '[bc]=== {type} ===[/bc]',
    planetDetailDescription: '  [w]{description}[/w]',
    planetDetailLine: '  [by]{label}[/by] [w]{value}[/w]',

    planetSpecsLoading: '\r\n[w]Loading planetary specs...[/w]',
    planetSpecsFailed: '[br]Failed to load planetary specs.[/br]',

    traderListLoading: '\r\n[w]Loading traders...[/w]',
    traderListHeader: '[bc]=== Traders in Universe ===[/bc]',
    traderListColumns: '  [bw]{name}[/bw] [bw]Ship[/bw]',
    traderListRow: '  [by]{name}[/by] [w]{ship}[/w]',
    traderListFailed: '[br]Failed to load trader list.[/br]',

    shipDataRequesting: '[w]Requesting ship data...[/w]',
    shipConfigNotFound: '[br]Ship config not found for: {name}[/br]',
});
