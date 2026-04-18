import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../packages/client/src/game/renderer.js';
import * as MESSAGES from '../packages/client/src/game/messages/index.js';

/**
 * Sample data for templates that use {placeholders}. Keyed by
 * `DOMAIN.templateKey`. If a template isn't listed here, it renders
 * with empty vars (literal placeholders remain for your inspection).
 */
const SAMPLES: Record<string, Record<string, unknown>> = {
    'SECTOR.header': { sector: 42 },
    'SECTOR.port': { name: 'Terra', class: 1, label: 'BBS' },
    'SECTOR.dronesYours': { qty: 25 },
    'SECTOR.dronesEnemy': { qty: 50, owner: 'PirateJoe' },
    'SECTOR.planetsLine': { list: '(sample list)' },
    'SECTOR.planetItem': { name: 'Earth', type: 'Terran' },
    'SECTOR.collisionWarning': { planet: 'Earth', target: 'Mars', hours: 12 },
    'SECTOR.warpsLine': { list: '(sample list)' },
    'SECTOR.warpVisited': { sector: 101 },
    'SECTOR.warpUnvisited': { sector: 202 },
    'SECTOR.playersLine': { list: '(sample list)' },
    'SECTOR.playerItem': { name: 'Alice' },
    'SECTOR.shipsLine': { list: '(sample list)' },
    'SECTOR.shipItem': { type: 'Constellation', owner: 'Bob' },
    'SECTOR.prompt': { sector: 42 },
    'SECTOR.playerInfoName': { name: 'Alice' },
    'SECTOR.playerInfoSector': { sector: 42 },
    'SECTOR.autopilotNotAdjacent': { hops: 4 },

    'HELP.lineText': { label: 'Command', text: 'Move to a sector by typing its number.' },
    'HELP.lineKey': { label: 'Display', key: 'D', text: 'refresh sector display.' },

    'PORT.menuHeader': { name: 'Terra', class: 1, label: 'BBS' },
    'PORT.commerceHeader': { name: 'Terra' },
    'PORT.commerceColumns': {
        items: 'Items'.padEnd(12),
        status: 'Status'.padEnd(10),
        trading: 'Trading'.padStart(7),
        pct: '% of max'.padStart(8),
        onBoard: 'OnBoard'.padStart(7),
    },
    'PORT.commerceDividers': {
        items: '-----'.padEnd(12),
        status: '------'.padEnd(10),
        trading: '-------'.padStart(7),
        pct: '--------'.padStart(8),
        onBoard: '-------'.padStart(7),
    },
    'PORT.commerceRowBuying': {
        name: 'Fuel'.padEnd(12),
        status: 'Buying'.padEnd(10),
        trading: '100'.padStart(7),
        pct: '50'.padStart(7),
        onBoard: '0'.padStart(7),
    },
    'PORT.commerceRowSelling': {
        name: 'Organics'.padEnd(12),
        status: 'Selling'.padEnd(10),
        trading: '200'.padStart(7),
        pct: '80'.padStart(7),
        onBoard: '5'.padStart(7),
    },
    'PORT.commerceFooter': { credits: '1,234', holds: 42 },
    'PORT.tradeQtyInfoBuy': { portTrading: 100, onBoard: 5 },
    'PORT.tradeQtyInfoSell': { portTrading: 100, onBoard: 5 },
    'PORT.tradeQtyPromptBuy': { commodity: 'Fuel', maxQty: 25 },
    'PORT.tradeQtyPromptSell': { commodity: 'Fuel', maxQty: 25 },
    'PORT.tradeConfirmSell': { total: '1,234' },
    'PORT.tradeConfirmBuy': { total: '1,234' },
    'PORT.class0Drones': { price: 20 },
    'PORT.class0Shields': { price: 10 },
    'PORT.class0Holds': { price: 50 },

    'PLANET.landing': { name: 'Earth' },
    'PLANET.colonists': { count: '1,000' },
    'PLANET.earthHeader': { count: '5,000' },

    'COMBAT.attackTarget': { n: 1, name: 'Alice' },
    'COMBAT.droneSectorCount': { count: 50, owner: 'PirateJoe' },
    'COMBAT.droneShipCount': { count: 25 },

    'STARBASE.hardwareItemRow': { key: 'T', label: 'Terraform Device    ', price: '10,000' },
    'STARBASE.buyQtyPrompt': { item: 'drones' },
    'STARBASE.planetSelectRow': { n: 1, name: 'Earth', type: 'Terran' },
    'STARBASE.shipyardsBuyRow': {
        letter: 'A',
        name: 'Constellation           ',
        price: '    50,000',
        current: '',
    },
    'STARBASE.shipyardsExamineHeader': { label: 'Examine' },
    'STARBASE.shipyardsExamineRow': { letter: 'A', name: 'Constellation' },
    'STARBASE.tradeinHeader': { ship: 'Imperial Starship', price: '100,000' },
    'STARBASE.tradeinCredit': { credit: '20,000' },
    'STARBASE.tradeinNet': { net: '80,000' },

    'COMPUTER.prompt': { sector: 42 },
    'COMPUTER.exploredHeader': { count: 42 },
    'COMPUTER.exploredSector': { n: 101 },
    'COMPUTER.unexploredHeader': { count: 458 },
    'COMPUTER.unexploredSector': { n: 202 },
    'COMPUTER.shipCatalogRow': { letter: 'A', name: 'Constellation' },
    'COMPUTER.shipDetailHeader': { name: 'Constellation' },
    'COMPUTER.shipDetailLine': { label: 'Max Drones          ', value: '100' },
    'COMPUTER.planetSpecsRow': { letter: 'A', type: 'Terran' },
    'COMPUTER.planetDetailHeader': { type: 'Terran' },
    'COMPUTER.planetDetailDescription': { description: 'A lush, habitable world.' },
    'COMPUTER.planetDetailLine': { label: 'Max Colonists       ', value: '10,000' },
    'COMPUTER.traderListColumns': { name: 'Name'.padEnd(24) },
    'COMPUTER.traderListRow': { name: 'Alice'.padEnd(24), ship: 'Constellation' },
    'COMPUTER.shipConfigNotFound': { name: 'Constellation' },

    'COMMON.menuRow': { key: 'A', text: 'Example action' },
    'COMMON.indexRow': { key: '1', text: 'Example action' },
    'COMMON.backRow': { text: 'Back' },
    'COMMON.listHeader': { title: 'Example' },
    'COMMON.howManyPrompt': { item: 'drones' },
    'COMMON.errorLine': { text: 'Something went wrong.' },

    'NOTIFY.welcome': { name: 'Alice' },
    'NOTIFY.starbaseLocation': { sector: 101 },
    'NOTIFY.error': { message: 'Not enough credits.' },
    'NOTIFY.unknownCommand': { cmd: 'foo' },

    'TRANSACTION.tradeComplete': { credits: '1,234' },
    'TRANSACTION.tradeConfirmSell': { total: '1,234' },
    'TRANSACTION.tradeConfirmBuy': { total: '1,234' },
    'TRANSACTION.purchaseStatsDrones': { credits: '10,000', drones: 100 },
    'TRANSACTION.purchaseStatsShields': { credits: '10,000', shields: 100 },
    'TRANSACTION.purchaseStatsHolds': { credits: '10,000', holds: 50 },
    'TRANSACTION.shipExchanged': { name: 'Merchant Cruiser' },
    'TRANSACTION.shipPurchased': { name: 'Merchant Cruiser' },
    'TRANSACTION.shipCreditsLine': { credits: '50,000' },
    'TRANSACTION.hardwareInstalled': { label: 'Hyperspace 1', credits: '5,000' },
    'TRANSACTION.hardwareStacked': { label: 'Buoys', total: 5, credits: '4,500' },
    'TRANSACTION.jettisoned': { items: '10 fuel, 5 organics' },

    'EVENT.attackDestroyed': { message: 'Target destroyed!' },
    'EVENT.attackCompleted': { message: 'Attack completed.' },
    'EVENT.attackStat': { label: 'Your drones lost', value: 5 },
    'EVENT.deployDronesInfo': { sector: 10, ship: 50, max: 100 },
    'EVENT.deployDronesResult': { sector: 20, ship: 40 },
    'EVENT.combatLost': { lost: 5, remaining: 15, ship: 35 },
    'EVENT.retreated': { sector: 42 },
    'EVENT.alertIntrusion': { intruder: 'PirateJoe', sector: 42 },
    'EVENT.alertAttacked': { intruder: 'PirateJoe', sector: 42, lost: 5, remaining: 15 },
    'EVENT.alertDestroyed': { intruder: 'PirateJoe', sector: 42 },
    'EVENT.planetDestroyed': { name: 'Earth' },
    'EVENT.terraformSuccess': { name: 'New Hope', type: 'Terran' },
    'EVENT.terraformDevicesRemaining': { count: 3 },
    'EVENT.terraformFailure': { reason: 'No terraform devices on ship.' },
    'EVENT.hyperspaceJump': { sector: 42, fuel: 10, turns: 5 },

    'PANEL.shipName': { name: 'Constellation' },
    'PANEL.shipDronesShields': { drones: 50, maxDrones: 100, shields: 80, maxShields: 100 },
    'PANEL.shipHolds': { free: 20, total: 75, max: 100 },
    'PANEL.shipCargo': { fuel: 10, organics: 20, equipment: 15, colonists: 5 },
    'PANEL.shipCreditsTurns': { credits: '10,000', turns: 500 },
    'PANEL.playersOnlineHeader': { count: 5 },
    'PANEL.playersOnlineRow': { name: 'Alice', suffix: '' },
    'PANEL.takeColonistsHeader': { qty: '1,000', commodity: 'fuel' },
    'PANEL.leaveColonistsHeader': { qty: '1,000', commodity: 'fuel' },
    'PANEL.planetColonistsLine': { count: '5,000' },
    'PANEL.shipColonistsLine': { count: 100 },
    'PANEL.landedHeader': { name: 'Earth' },
    'PANEL.landedType': { type: 'Terran' },
    'PANEL.landedStats': { drones: 50, fuel: 10, organics: 20, equipment: 15 },
    'PANEL.landedColonists': { fuel: 100, organics: 200, equipment: 150 },
    'PANEL.planetDisplayHeader': { name: 'Earth', type: 'Terran' },
    'PANEL.deployedDronesRow': { sector: 42, qty: 25 },
    'PANEL.listPlanetsRow': { sector: 42, name: 'Earth', type: 'Terran' },
    'PANEL.listPlanetsColonists': { fuel: 100, organics: 200, equipment: 150 },
};

const SKIP_EXPORTS = new Set(['HELP_LINES']);

/** Domain → output file path. The path for a filtered preview sits next to
 *  the source file that defines the domain so you can open source + preview
 *  side-by-side in VS Code. */
const DOMAIN_OUTPUT: Record<string, string> = {
    MSG: '../packages/client/src/game/messages.preview.ansi',
    COMMON: '../packages/client/src/game/messages/common.preview.ansi',
    SECTOR: '../packages/client/src/game/messages/sector.preview.ansi',
    HELP: '../packages/client/src/game/messages/help.preview.ansi',
    PORT: '../packages/client/src/game/messages/port.preview.ansi',
    PLANET: '../packages/client/src/game/messages/planet.preview.ansi',
    STARBASE: '../packages/client/src/game/messages/starbase.preview.ansi',
    COMPUTER: '../packages/client/src/game/messages/computer.preview.ansi',
    COMBAT: '../packages/client/src/game/messages/combat.preview.ansi',
    NOTIFY: '../packages/client/src/game/messages/notifications.preview.ansi',
    TRANSACTION: '../packages/client/src/game/messages/transactions.preview.ansi',
    EVENT: '../packages/client/src/game/messages/events.preview.ansi',
    PANEL: '../packages/client/src/game/messages/panels.preview.ansi',
};

const args = process.argv.slice(2).map((a) => a.toUpperCase());
const filter = args.length > 0 ? new Set(args) : null;

if (filter) {
    const unknown = [...filter].filter((d) => !(d in DOMAIN_OUTPUT));
    if (unknown.length > 0) {
        process.stderr.write(`Unknown domain(s): ${unknown.join(', ')}\n`);
        process.stderr.write(`Valid: ${Object.keys(DOMAIN_OUTPUT).join(', ')}\n`);
        process.exit(1);
    }
}

const lines: string[] = [];
for (const [domain, group] of Object.entries(MESSAGES)) {
    if (SKIP_EXPORTS.has(domain)) continue;
    if (typeof group !== 'object' || group === null) continue;
    if (filter && !filter.has(domain)) continue;
    lines.push(`\x1b[1;36m── ${domain} ──\x1b[0m`);
    for (const [key, template] of Object.entries(group as Record<string, string>)) {
        const sampleKey = `${domain}.${key}`;
        const vars = SAMPLES[sampleKey] ?? {};
        const rendered = render(template, vars).replace(/\r\n/g, '\n    ');
        lines.push(`\x1b[2m${key.padEnd(26)}\x1b[0m ${rendered}`);
    }
    lines.push('');
}

const output = lines.join('\n');
process.stdout.write(output);

// Write target: if filtering to a single domain, use that domain's file; else
// write the full combined preview.
const targetRel =
    filter && filter.size === 1
        ? DOMAIN_OUTPUT[[...filter][0]]
        : '../packages/client/src/game/messages.preview.ansi';
const target = resolve(import.meta.dirname, targetRel);
writeFileSync(target, output);
process.stderr.write(`\n→ wrote ${target}\n`);
