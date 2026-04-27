import type { ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { STARBASE, COMMON } from './messages/index.js';
import { showClass0Menu, showClass0QtyPrompt } from './display-port.js';
import { showShipInterestPrompt } from './display-computer.js';

export function showStarbasePrompt(ctx: GameContext) {
    ctx.term.write(render(STARBASE.rootPrompt));
}

export function showStarbaseMenu(ctx: GameContext) {
    showStarbasePrompt(ctx);
}

export function showStarbaseHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render(COMMON.menuRow, { key: 'S', text: 'Shipyards' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'H', text: 'Hardware Store' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave Starbase' }));
    showStarbasePrompt(ctx);
}

function fmt(n: number): string {
    return n.toLocaleString();
}

/** Strip [tag]/[/tag] markup to measure the on-screen width of a colored string. */
function visibleLength(s: string): number {
    return s.replace(/\[\/?[a-zA-Z:0-9]+\]/g, '').length;
}

/** padEnd that counts visible characters, so color-tagged strings still align. */
function padVisible(s: string, width: number): string {
    const n = visibleLength(s);
    return n >= width ? s : s + ' '.repeat(width - n);
}

/**
 * Given the item chosen by the user, compute how many they can afford to buy
 * (bounded by remaining capacity and credits) and print a one-line detail.
 * Returns the capped maximum so the qty prompt can use it as a default.
 */
export function showHardwareItemDetail(ctx: GameContext, itemName: string): number {
    const item = ctx.hardwareStoreItems.find((i) => i.name === itemName);
    if (!item) return 0;
    const remaining = Math.max(0, item.maxQty - item.currentQty);
    const affordable =
        item.price > 0 ? Math.floor(ctx.hardwareStoreCredits / item.price) : remaining;
    const canBuy = Math.min(remaining, affordable);
    ctx.term.writeln(
        render(STARBASE.hardwareItemDetail, {
            label: item.label,
            price: fmt(item.price),
            current: item.currentQty,
            max: item.maxQty,
            canBuy: fmt(canBuy),
        }),
    );
    return canBuy;
}

const HW_KEY_MAP: Record<string, string> = {
    terraform_device: 'T',
    planet_buster: 'B',
    buoy: 'U',
    proximity_mine: 'P',
    seeker_mine: 'S',
    orbital_mine: 'O',
    mine_disruptor: 'D',
    hyperspace_1: '1',
    hyperspace_2: '2',
    visual_scanner: 'V',
    planet_scanner: 'N',
    cloaking_device: 'K',
    corbomite: 'C',
    photon_torpedo: 'H',
    recon_drone: 'R',
};

export function showHardwareMenu(ctx: GameContext) {
    const items = ctx.hardwarePrices;
    ctx.term.writeln('');
    if (items) {
        for (const item of items) {
            const key = HW_KEY_MAP[item.name] ?? '?';
            ctx.term.writeln(
                render(STARBASE.hardwareItemRow, {
                    key,
                    label: item.label.padEnd(19),
                    price: fmt(item.price),
                }),
            );
        }
    }
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
    ctx.term.writeln(render(STARBASE.hardwareCredits, { credits: fmt(ctx.hardwareStoreCredits) }));
    ctx.term.write(render(STARBASE.hardwarePrompt));
}

export function showBuyQtyPrompt(ctx: GameContext, item: string, canBuy: number) {
    ctx.term.write(render(STARBASE.buyQtyPrompt, { item, canBuy }));
}

export function showPlanetSelectMenu(
    ctx: GameContext,
    planets: { id: number; name: string; type: string }[],
) {
    ctx.term.writeln('');
    ctx.term.writeln(render(STARBASE.planetSelectHeader));
    planets.forEach((p, i) => {
        ctx.term.writeln(
            render(STARBASE.planetSelectRow, { n: i + 1, name: p.name, type: p.type }),
        );
    });
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

// --- Shipyards ---

export function showShipyardsPrompt(ctx: GameContext) {
    ctx.term.write(render(STARBASE.shipyardsPrompt));
}

export function showShipyardsMenu(ctx: GameContext) {
    showShipyardsPrompt(ctx);
}

export function showShipyardsHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render(COMMON.menuRow, { key: 'B', text: 'Buy a new ship' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Examine ship specs' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'P', text: 'Purchase equipment (Class 0)' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back to Starbase' }));
    showShipyardsPrompt(ctx);
}

/** Map index to letter, skipping Q (reserved for quit). */
export function indexToLetter(i: number): string {
    const code = 65 + i + (i >= 16 ? 1 : 0);
    return String.fromCharCode(code);
}

/** Reverse: letter back to index, accounting for skipped Q. */
export function letterToIndex(letter: string): number {
    const code = letter.toUpperCase().charCodeAt(0) - 65;
    if (code > 16) return code - 1;
    return code;
}

function calculateShipPrice(ship: ShipCatalogEntry): number {
    return (
        (ship.cost_drive ?? 0) +
        (ship.cost_computer ?? 0) +
        (ship.cost_hull ?? 0) +
        (ship.starting_holds ?? 0) * (ship.hold_cost ?? 0)
    );
}

async function loadShipConfigs(ctx: GameContext): Promise<boolean> {
    if (ctx.shipConfigs) return true;
    ctx.term.writeln(render(STARBASE.loadingShipCatalog));
    try {
        const res = await fetch('/api/ships');
        ctx.shipConfigs = await res.json();
        return true;
    } catch {
        ctx.term.writeln(render(STARBASE.shipCatalogFailed));
        showShipyardsPrompt(ctx);
        return false;
    }
}

export async function showShipBuyList(ctx: GameContext) {
    if (!(await loadShipConfigs(ctx))) return;
    ctx.term.writeln('');
    ctx.term.writeln(render(STARBASE.shipyardsBuyHeader));
    ctx.shipConfigs!.forEach((ship, i) => {
        const current =
            ship.name === ctx.currentShipName ? render(STARBASE.shipyardsBuyCurrent) : '';
        ctx.term.writeln(
            render(STARBASE.shipyardsBuyRow, {
                letter: indexToLetter(i),
                name: padVisible(ship.display_name ?? ship.name, 24),
                price: calculateShipPrice(ship).toLocaleString().padStart(10),
                current,
            }),
        );
    });
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showShipExamineList(ctx: GameContext) {
    showShipListInternal(ctx, 'Examine');
}

async function showShipListInternal(ctx: GameContext, label: string) {
    if (!(await loadShipConfigs(ctx))) return;
    ctx.term.writeln('');
    ctx.term.writeln(render(STARBASE.shipyardsExamineHeader, { label }));
    ctx.shipConfigs!.forEach((ship, i) => {
        ctx.term.writeln(
            render(STARBASE.shipyardsExamineRow, {
                letter: indexToLetter(i),
                name: ship.display_name ?? ship.name,
            }),
        );
    });
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
    showShipInterestPrompt(ctx);
}

export function showTradeinPrompt(
    ctx: GameContext,
    shipName: string,
    price: number,
    tradeinCredit: number,
) {
    ctx.term.writeln('');
    ctx.term.writeln(render(STARBASE.tradeinHeader, { ship: shipName, price: fmt(price) }));
    if (tradeinCredit > 0) {
        ctx.term.writeln(render(STARBASE.tradeinCredit, { credit: fmt(tradeinCredit) }));
        ctx.term.writeln(render(STARBASE.tradeinNet, { net: fmt(price - tradeinCredit) }));
    }
    ctx.term.write(render(STARBASE.tradeinConfirm));
}

export function showShipyardsClass0Menu(ctx: GameContext) {
    showClass0Menu(ctx);
}

export function showShipyardsClass0QtyPrompt(
    ctx: GameContext,
    item: 'drones' | 'shields' | 'holds',
) {
    showClass0QtyPrompt(ctx, item);
}
