import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { TRANSACTION, PANEL } from '../messages/index.js';
import { showPrompt, type DisplayCtx } from '../display.js';
import { showClass0Menu, type DisplayPortCtx } from '../display-port.js';
import { showHardwareMenu, type DisplayStarbaseCtx } from '../display-starbase.js';
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
    if (ctx.world.dockedPortInfo?.class === 0 || ctx.starbase.class0ShipState) {
        showClass0Menu(ctx);
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
    if (ctx.world.dockedPortInfo?.class === 0 || ctx.starbase.class0ShipState) {
        showClass0Menu(ctx);
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
    if (ctx.world.dockedPortInfo?.class === 0 || ctx.starbase.class0ShipState) {
        showClass0Menu(ctx);
    }
};

export const buyHardware: Handler<'buyHardwareResult', HardwareStoreDeps> = (ctx, msg) => {
    if (msg.kind === 'toggle') {
        ctx.io.term.writeln(
            render(TRANSACTION.hardwareInstalled, { label: msg.label, credits: msg.credits }),
        );
    } else {
        ctx.io.term.writeln(
            render(TRANSACTION.hardwareStacked, {
                label: msg.label,
                total: msg.totalOnShip,
                credits: msg.credits,
            }),
        );
    }
    ctx.io.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
};

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
    showPrompt(ctx);
};
