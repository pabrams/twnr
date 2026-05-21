/**
 * Ship computer: prompts, known-universe, ship catalog, ship/planet detail,
 * trader list.
 */

import { makeDomain } from './_domain.js';

export const COMPUTER = makeDomain('COMPUTER', {
    prompt: '\r\n[mg]Computer command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by][br]=[/br][by]Help[/by][mg])[/mg] [by]:[/by] ',
    basePrompt:
        '\r\n[mg]Base Computer command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by][br]=[/br][by]Help[/by][mg])[/mg] [by]:[/by] ',

    activated: '\r\n[bc]<Computer activated>[/bc]',
    deactivated: '\r\n[bc]<Computer deactivated>[/bc]',

    knownUniversePrompt:
        '\r\n[bc]Known Universe[/bc] — [by]E[/by]xplored, [by]U[/by]nexplored, [by]Q[/by]uit? ',

    hyperspaceJumpTargetPrompt:
        '\r\n[mg]Target sector[/mg] [mg]([/mg][by]#[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',

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
    planetSpecsRow: '  [mg]<[/mg][by]{letter}[/by][mg]>[/mg]  {type}',
    planetSpecsPrompt:
        '\r\n[mg]Planet specs[/mg] [mg]([/mg][by]?[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
    planetDetailHeader: '[bc]===[/bc] {type} [bc]===[/bc]',
    planetDetailDescription: '  [g]{description}[/g]',
    planetDetailLine: '  [by]{label}[/by] [g]{value}[/g]',

    planetSpecsLoading: '\r\n[g]Loading planetary specs...[/g]',
    planetSpecsFailed: '[br]Failed to load planetary specs.[/br]',

    traderListLoading: '\r\n[g]Loading traders...[/g]',
    traderListHeader: '[bc]=== Traders in Universe ===[/bc]',
    traderListColumns: '  [bw]{name} {clan} {rep} {exp} {ship}[/bw]',
    traderListRow: '  [by]{name}[/by] [g]{clan}[/g] [g]{rep}[/g] [g]{exp}[/g] [g]{ship}[/g]',
    traderListShipDestroyed: '[bb]### [y]SHIP DESTROYED[/y] ###[/bb]',
    traderListFailed: '[br]Failed to load trader list.[/br]',
    traderListClanNA: '[g]NA[/g]',
    traderListClanValue: '[bc]#{n}[/bc]',

    shipDataRequesting: '[g]Requesting ship data...[/g]',
    shipConfigNotFound: '[br]Ship config not found for: {name}[/br]',

    ownershipPrompt:
        '\r\n[mg]Set current ship ownership: ([/mg][by]P[/by][mg]ersonal, [/mg][by]C[/by][mg]lan, [/mg][by]Q[/by][mg]) [/mg][by]?[/by] ',
    ownershipResultPersonal: '\r\n[bg]Ship is now personally owned.[/bg]',
    ownershipResultClan: '\r\n[bg]Ship is now clan-owned.[/bg]',

    activeShipScanHeader: '                       [bc]--<  Available Ship Scan  >--[/bc]',
    activeShipScanColumns:
        '[bw]  Ship Sect Name             Owner       Drones Shields Holds Hops Type[/bw]',
    activeShipScanRule:
        '[g]-----------------------------------------------------------------------------------[/g]',
    activeShipScanRow:
        '{marker} [by]{shipNum}[/by] [bc]{sect}[/bc] [g]{name}[/g] [g]{owner}[/g] [bc]{drones}[/bc] [bc]{shields}[/bc] [bc]{holds}[/bc] {hops}  [g]{type}[/g]',
    activeShipScanHopsInRange: '[bg]{hops}[/bg]',
    activeShipScanHopsOutOfRange: '[br]{hops}[/br]',
    activeShipScanHopsNeutral: '[bc]{hops}[/bc]',
    activeShipScanCurrentMarker: '[br]*[/br]',
    activeShipScanBlankMarker: ' ',
    activeShipScanEmpty: '[g]You own no ships.[/g]',

    transporterIntrasectorOnly: '[g]Your [/g][bc]{ship}[/bc] [g]can only beam intrasector.[/g]',
    transporterRangeStatement:
        '[g]Your [/g][bc]{ship}[/bc] [g]has a transport range of [/g][bc]{range}[/bc] [g]hops.[/g]',
    transporterNoCurrentShip: '[br]You have no ship.[/br]',
    transporterOptionsBlank: '',
    transporterOptionDetails: '[mg]<[/mg][by]I[/by][mg]>[/mg] [bc]Ship details[/bc]',
    transporterOptionExit: '[mg]<[/mg][by]Q[/by][mg]>[/mg] [bc]Exit Transporter[/bc]',
    transporterPrompt:
        '\r\n[mg]Choose which ship to beam to ([/mg][by]?[/by][mg]=list) [/mg][by]:[/by] ',
    transporterDetailsPrompt:
        '\r\n[mg]Show details for which ship? ([/mg][by]Q[/by][mg]=Quit) [/mg][by]?[/by] ',
    transporterSuccess: '[bg]Security code accepted, engaging transporter control.[/bg]',
    transporterTurnsLeft: '[g]One turn deducted, [/g][bc]{turns}[/bc] [g]turns left.[/g]',
    transporterUnknownShip: '[br]No ship with that number.[/br]',
    transporterCannotSelf: '[br]Already on that ship.[/br]',
    transporterDetailHeader: '[bc]Ship #{shipNum}[/bc]',
    transporterDetailLine: '  [g]{label}[/g] [by]:[/by] [bc]{value}[/bc]',

    mineScanBanner: '[bc]<Mine Scanning>[/bc]',
    mineScanPrompt:
        ' Scan which mine type, [mg]<[/mg][by]P[/by][mg]>[/mg] Proximity or [mg]<[/mg][by]L[/by][mg]>[/mg] Limpet ? :',
});
