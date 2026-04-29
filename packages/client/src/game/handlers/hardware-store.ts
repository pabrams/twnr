import { ClientMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { TRANSACTION, PANEL } from '../messages/index.js';
import { showPrompt } from '../display.js';
import { showClass0Menu } from '../display-port.js';
import { showHardwareMenu } from '../display-starbase.js';
import type { Handler } from './index.js';

export const buyDrones: Handler<'buyDronesResult'> = (ctx, msg) => {
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

export const buyShields: Handler<'buyShieldsResult'> = (ctx, msg) => {
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

export const buyHolds: Handler<'buyHoldsResult'> = (ctx, msg) => {
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

export const buyHardware: Handler<'buyHardwareResult'> = (ctx, msg) => {
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

export const hardwareStoreInfo: Handler<'hardwareStoreInfoResult'> = (ctx, msg) => {
    ctx.starbase.hardwareStoreCredits = msg.credits;
    ctx.starbase.hardwareStoreItems = msg.items;
    showHardwareMenu(ctx);
};

export const listDeployedDrones: Handler<'listDeployedDronesResult'> = (ctx, msg) => {
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
