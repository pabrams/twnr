import type { ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { STARBASE, COMMON } from './messages/index.js';
import { showClass0Menu, type DisplayPortCtx } from './display-port.js';
import { type DisplayComputerCtx } from './display-computer.js';
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

// Mines live behind the M sub-prompt so they aren't listed here. Must match the
// STACKABLE/TOGGLE maps in routines/hardware-routines.ts and the starbaseHardware
// entry in menu-registry.ts.
const HW_KEY_MAP: Record<string, string> = {
    terraform_device: 'T',
    planet_buster: 'B',
    buoy: 'U',
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

const MINE_NAMES = new Set(['proximity_mine', 'seeker_mine']);

export function showHardwareMenu(ctx: DisplayStarbaseCtx) {
    const items = ctx.catalogs.hardwarePrices;
    ctx.io.term.writeln('');
    let minesShown = false;
    if (items) {
        for (const item of items) {
            if (MINE_NAMES.has(item.name)) {
                if (!minesShown) {
                    ctx.io.term.writeln(
                        render(STARBASE.hardwareItemRow, {
                            key: 'M',
                            label: 'Mines'.padEnd(19),
                            price: '—',
                        }),
                    );
                    minesShown = true;
                }
                continue;
            }
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
}

export function showHardwarePrompt(ctx: DisplayStarbaseCtx) {
    ctx.io.term.writeln(
        render(STARBASE.hardwareCredits, { credits: fmt(ctx.starbase.hardwareStoreCredits) }),
    );
    ctx.io.term.write(render(STARBASE.hardwarePrompt));
}

export function showShipyardsPrompt(ctx: DisplayStarbaseCtx) {
    ctx.io.term.write(render(STARBASE.shipyardsPrompt));
}

export function showShipyardsMenu(ctx: DisplayStarbaseCtx) {
    showShipyardsPrompt(ctx);
}

/** Skips Q — reserved for quit. */
export function indexToLetter(i: number): string {
    const code = 65 + i + (i >= 16 ? 1 : 0);
    return String.fromCharCode(code);
}

export function letterToIndex(letter: string): number {
    const code = letter.toUpperCase().charCodeAt(0) - 65;
    if (code > 16) return code - 1;
    return code;
}

export function showShipBuyList(ctx: DisplayStarbaseCtx, ships: ShipCatalogEntry[]) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(STARBASE.shipyardsBuyHeader));
    ships.forEach((ship, i) => {
        const current =
            ship.name === ctx.ship.currentShipTypeName ? render(STARBASE.shipyardsBuyCurrent) : '';
        ctx.io.term.writeln(
            render(STARBASE.shipyardsBuyRow, {
                letter: indexToLetter(i),
                name: padEndVisible(ship.displayName ?? ship.name, 24),
                price: ship.baseCost.toLocaleString().padStart(10),
                current,
            }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showShipyardsBuyPrompt(ctx: DisplayStarbaseCtx) {
    ctx.io.term.write(render(STARBASE.shipyardsBuyPrompt));
}

export function showShipExamineList(ctx: DisplayStarbaseCtx, ships: ShipCatalogEntry[]) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(STARBASE.shipyardsExamineHeader, { label: 'Examine' }));
    ships.forEach((ship, i) => {
        ctx.io.term.writeln(
            render(STARBASE.shipyardsExamineRow, {
                letter: indexToLetter(i),
                name: ship.displayName ?? ship.name,
            }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showTradeinInfo(
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
}

export function showShipyardsClass0Menu(ctx: DisplayStarbaseCtx) {
    showClass0Menu(ctx);
}
