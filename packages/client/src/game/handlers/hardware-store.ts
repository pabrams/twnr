import { Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { TRANSACTION } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { showHardwareMenu, type DisplayStarbaseCtx } from '../display-starbase.js';
import { fmt } from './utils.js';
import type { Handler } from './index.js';

type HardwareStoreContext = Pick<GameContext, 'io' | 'starbase' | 'world'> &
    DisplayCtx &
    DisplayPortCtx &
    DisplayStarbaseCtx;

export const buyDrones: Handler<'buyDronesResult', HardwareStoreContext> = (ctx, msg) => {
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

export const buyShields: Handler<'buyShieldsResult', HardwareStoreContext> = (ctx, msg) => {
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

export const buyHolds: Handler<'buyHoldsResult', HardwareStoreContext> = (ctx, msg) => {
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

export const buyHardware: Handler<'buyHardwareResult', HardwareStoreContext> = (ctx, msg) => {
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

    ctx.starbase.hardwareStoreCredits = msg.credits;
    const item = ctx.starbase.hardwareStoreItems.find((i) => i.name === msg.itemName);
    if (item) {
        if (msg.kind === 'toggle') item.currentQty = 1;
        else if (msg.totalOnShip != null) item.currentQty = msg.totalOnShip;
    }
};

export const hardwareStoreInfo: Handler<'hardwareStoreInfoResult', HardwareStoreContext> = (
    ctx,
    msg,
) => {
    ctx.world.mode = Menu.StarbaseHardware;
    ctx.starbase.hardwareStoreCredits = msg.credits;
    ctx.starbase.hardwareStoreItems = msg.items;
    showHardwareMenu(ctx);
};

