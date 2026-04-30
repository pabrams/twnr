import type { ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { STARBASE, COMMON } from './messages/index.js';
import { showClass0Menu, showClass0QtyPrompt, type DisplayPortCtx } from './display-port.js';
import { showShipInterestPrompt, type DisplayComputerCtx } from './display-computer.js';
import { padEndVisible } from './display-utils.js';

export type DisplayStarbaseCtx = Pick<GameContext, 'catalogs' | 'io' | 'ship' | 'starbase'> &
    DisplayPortCtx &
    DisplayComputerCtx;

export function showStarbasePrompt(ctx: DisplayStarbaseCtx) {
    ctx.io.term.write(render(STARBASE.rootPrompt));
}

export function showStarbaseMenu(ctx: DisplayStarbaseCtx) {
    showStarbasePrompt(ctx);
}

export function showStarbaseHelp(ctx: DisplayStarbaseCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'S', text: 'Shipyards' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'H', text: 'Hardware Store' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave Starbase' }));
    showStarbasePrompt(ctx);
}

function fmt(n: number): string {
    return n.toLocaleString();
}

export function showHardwareItemDetail(ctx: DisplayStarbaseCtx, itemName: string): number {
    const item = ctx.starbase.hardwareStoreItems.find((i) => i.name === itemName);
    if (!item) return 0;
    const remaining = Math.max(0, item.maxQty - item.currentQty);
    const affordable =
        item.price > 0 ? Math.floor(ctx.starbase.hardwareStoreCredits / item.price) : remaining;
    const canBuy = Math.min(remaining, affordable);
    ctx.io.term.writeln(
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

export function showHardwareMenu(ctx: DisplayStarbaseCtx) {
    const items = ctx.catalogs.hardwarePrices;
    ctx.io.term.writeln('');
    if (items) {
        for (const item of items) {
            const key = HW_KEY_MAP[item.name] ?? '?';
            ctx.io.term.writeln(
                render(STARBASE.hardwareItemRow, {
                    key,
                    label: item.label.padEnd(19),
                    price: fmt(item.price),
                }),
            );
        }
    }
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
    ctx.io.term.writeln(
        render(STARBASE.hardwareCredits, { credits: fmt(ctx.starbase.hardwareStoreCredits) }),
    );
    ctx.io.term.write(render(STARBASE.hardwarePrompt));
}

export function showBuyQtyPrompt(ctx: DisplayStarbaseCtx, item: string, canBuy: number) {
    ctx.io.term.write(render(STARBASE.buyQtyPrompt, { item, canBuy }));
}

export function showPlanetSelectMenu(
    ctx: DisplayStarbaseCtx,
    planets: { id: number; name: string; type: string }[],
) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(STARBASE.planetSelectHeader));
    planets.forEach((p, i) => {
        ctx.io.term.writeln(
            render(STARBASE.planetSelectRow, { n: i + 1, name: p.name, type: p.type }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showShipyardsPrompt(ctx: DisplayStarbaseCtx) {
    ctx.io.term.write(render(STARBASE.shipyardsPrompt));
}

export function showShipyardsMenu(ctx: DisplayStarbaseCtx) {
    showShipyardsPrompt(ctx);
}

export function showShipyardsHelp(ctx: DisplayStarbaseCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'B', text: 'Buy a new ship' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Examine ship specs' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'P', text: 'Purchase equipment (Class 0)' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back to Starbase' }));
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

async function loadShipConfigs(ctx: DisplayStarbaseCtx): Promise<boolean> {
    if (ctx.catalogs.ships) return true;
    ctx.io.term.writeln(render(STARBASE.loadingShipCatalog));
    try {
        const res = await fetch('/api/ships');
        ctx.catalogs.ships = await res.json();
        return true;
    } catch {
        ctx.io.term.writeln(render(STARBASE.shipCatalogFailed));
        showShipyardsPrompt(ctx);
        return false;
    }
}

export async function showShipBuyList(ctx: DisplayStarbaseCtx) {
    if (!(await loadShipConfigs(ctx))) return;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(STARBASE.shipyardsBuyHeader));
    ctx.catalogs.ships!.forEach((ship, i) => {
        const current =
            ship.name === ctx.ship.currentShipName ? render(STARBASE.shipyardsBuyCurrent) : '';
        ctx.io.term.writeln(
            render(STARBASE.shipyardsBuyRow, {
                letter: indexToLetter(i),
                name: padEndVisible(ship.display_name ?? ship.name, 24),
                price: calculateShipPrice(ship).toLocaleString().padStart(10),
                current,
            }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showShipExamineList(ctx: DisplayStarbaseCtx) {
    showShipListInternal(ctx, 'Examine');
}

async function showShipListInternal(ctx: DisplayStarbaseCtx, label: string) {
    if (!(await loadShipConfigs(ctx))) return;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(STARBASE.shipyardsExamineHeader, { label }));
    ctx.catalogs.ships!.forEach((ship, i) => {
        ctx.io.term.writeln(
            render(STARBASE.shipyardsExamineRow, {
                letter: indexToLetter(i),
                name: ship.display_name ?? ship.name,
            }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
    showShipInterestPrompt(ctx);
}

export function showTradeinPrompt(
    ctx: DisplayStarbaseCtx,
    shipName: string,
    price: number,
    tradeinCredit: number,
) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(STARBASE.tradeinHeader, { ship: shipName, price: fmt(price) }));
    if (tradeinCredit > 0) {
        ctx.io.term.writeln(render(STARBASE.tradeinCredit, { credit: fmt(tradeinCredit) }));
        ctx.io.term.writeln(render(STARBASE.tradeinNet, { net: fmt(price - tradeinCredit) }));
    }
    ctx.io.term.write(render(STARBASE.tradeinConfirm));
}

export function showShipyardsClass0Menu(ctx: DisplayStarbaseCtx) {
    showClass0Menu(ctx);
}

export function showShipyardsClass0QtyPrompt(
    ctx: DisplayStarbaseCtx,
    item: 'drones' | 'shields' | 'holds',
) {
    showClass0QtyPrompt(ctx, item);
}
