import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { TRANSACTION, PANEL } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { showHardwareMenu, type DisplayStarbaseCtx } from '../display-starbase.js';
import { fmt } from './utils.js';
import type { Handler } from './index.js';

type HardwareStoreDeps = Pick<GameContext, 'io' | 'starbase' | 'world'> &
    DisplayCtx &
    DisplayPortCtx &
    DisplayStarbaseCtx;

export const buyDrones: Handler<'buyDronesResult', HardwareStoreDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(TRANSACTION.purchaseComplete));
    ctx.io.term.writeln(
        render(TRANSACTION.purchaseStatsDrones, {
            credits: msg.credits,
            drones: msg.drones,
        }),
    );
    if (ctx.starbase.class0ShipState) {
        ctx.starbase.class0ShipState.credits = msg.credits;
        ctx.starbase.class0ShipState.drones = msg.drones;
    }
};

export const buyShields: Handler<'buyShieldsResult', HardwareStoreDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(TRANSACTION.purchaseComplete));
    ctx.io.term.writeln(
        render(TRANSACTION.purchaseStatsShields, {
            credits: msg.credits,
            shields: msg.shields,
        }),
    );
    if (ctx.starbase.class0ShipState) {
        ctx.starbase.class0ShipState.credits = msg.credits;
        ctx.starbase.class0ShipState.shields = msg.shields;
    }
};

export const buyHolds: Handler<'buyHoldsResult', HardwareStoreDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(TRANSACTION.purchaseComplete));
    ctx.io.term.writeln(
        render(TRANSACTION.purchaseStatsHolds, {
            credits: msg.credits,
            holds: msg.cargoLimit,
        }),
    );
    if (ctx.starbase.class0ShipState) {
        ctx.starbase.class0ShipState.credits = msg.credits;
        ctx.starbase.class0ShipState.holds = msg.cargoLimit;
    }
};

export const buyHardware: Handler<'buyHardwareResult', HardwareStoreDeps> = (ctx, msg) => {
    if (msg.kind === 'toggle') {
        ctx.io.term.writeln(
            render(TRANSACTION.hardwareInstalled, { label: msg.label, cost: fmt(msg.cost) }),
        );
    } else {
        ctx.io.term.writeln(
            render(TRANSACTION.hardwareStacked, {
                label: msg.label,
                quantity: msg.quantity ?? 0,
                cost: fmt(msg.cost),
            }),
        );
    }
    // Update local state from the purchase result so we don't need a
    // HardwareStoreInfo roundtrip (which would re-render the full menu
    // and drown the action's output). The framework's auto-render fires
    // showHardwarePrompt right after this handler, showing the new
    // credits inline with the prompt.
    ctx.starbase.hardwareStoreCredits = msg.credits;
    const item = ctx.starbase.hardwareStoreItems.find((i) => i.name === msg.itemName);
    if (item) {
        if (msg.kind === 'toggle') item.currentQty = 1;
        else if (msg.totalOnShip != null) item.currentQty = msg.totalOnShip;
    }
};

/** First entry to the hardware store. Renders the full catalog listing
 * once; the prompt+credits is added by the menu's `renderPrompt` (which
 * the framework calls right after this handler). Subsequent purchases
 * skip the catalog re-render. */
export const hardwareStoreInfo: Handler<'hardwareStoreInfoResult', HardwareStoreDeps> = (
    ctx,
    msg,
) => {
    ctx.starbase.hardwareStoreCredits = msg.credits;
    ctx.starbase.hardwareStoreItems = msg.items;
    showHardwareMenu(ctx);
};

export const listDeployedDrones: Handler<'listDeployedDronesResult', HardwareStoreDeps> = (
    ctx,
    msg,
) => {
    ctx.io.term.writeln('');
    if (msg.drones.length === 0) {
        ctx.io.term.writeln(render(PANEL.deployedDronesEmpty));
    } else {
        ctx.io.term.writeln(render(PANEL.deployedDronesHeader));
        for (const d of msg.drones) {
            ctx.io.term.writeln(
                render(PANEL.deployedDronesRow, { sector: d.sectorId, qty: d.quantity }),
            );
        }
    }
};
