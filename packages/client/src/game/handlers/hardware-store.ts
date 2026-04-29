import { ClientMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { TRANSACTION, PANEL } from '../messages/index.js';
import { showPrompt } from '../display.js';
import { showClass0Menu } from '../display-port.js';
import { showHardwareMenu } from '../display-starbase.js';
import type { Handler } from './index.js';

export const buyDrones: Handler<'buyDronesResult'> = (ctx, msg) => {
    ctx.term.writeln(render(TRANSACTION.purchaseComplete));
    ctx.term.writeln(
        render(TRANSACTION.purchaseStatsDrones, {
            credits: msg.credits,
            drones: msg.drones,
        }),
    );
    if (ctx.class0ShipState) {
        ctx.class0ShipState.credits = msg.credits;
        ctx.class0ShipState.drones = msg.drones;
    }
    if (ctx.dockedPortInfo?.class === 0 || ctx.class0ShipState) {
        showClass0Menu(ctx);
    }
};

export const buyShields: Handler<'buyShieldsResult'> = (ctx, msg) => {
    ctx.term.writeln(render(TRANSACTION.purchaseComplete));
    ctx.term.writeln(
        render(TRANSACTION.purchaseStatsShields, {
            credits: msg.credits,
            shields: msg.shields,
        }),
    );
    if (ctx.class0ShipState) {
        ctx.class0ShipState.credits = msg.credits;
        ctx.class0ShipState.shields = msg.shields;
    }
    if (ctx.dockedPortInfo?.class === 0 || ctx.class0ShipState) {
        showClass0Menu(ctx);
    }
};

export const buyHolds: Handler<'buyHoldsResult'> = (ctx, msg) => {
    ctx.term.writeln(render(TRANSACTION.purchaseComplete));
    ctx.term.writeln(
        render(TRANSACTION.purchaseStatsHolds, {
            credits: msg.credits,
            holds: msg.cargoLimit,
        }),
    );
    if (ctx.class0ShipState) {
        ctx.class0ShipState.credits = msg.credits;
        ctx.class0ShipState.holds = msg.cargoLimit;
    }
    if (ctx.dockedPortInfo?.class === 0 || ctx.class0ShipState) {
        showClass0Menu(ctx);
    }
};

export const buyHardware: Handler<'buyHardwareResult'> = (ctx, msg) => {
    if (msg.kind === 'toggle') {
        ctx.term.writeln(
            render(TRANSACTION.hardwareInstalled, { label: msg.label, credits: msg.credits }),
        );
    } else {
        ctx.term.writeln(
            render(TRANSACTION.hardwareStacked, {
                label: msg.label,
                total: msg.totalOnShip,
                credits: msg.credits,
            }),
        );
    }
    ctx.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
};

export const hardwareStoreInfo: Handler<'hardwareStoreInfoResult'> = (ctx, msg) => {
    ctx.hardwareStoreCredits = msg.credits;
    ctx.hardwareStoreItems = msg.items;
    showHardwareMenu(ctx);
};

export const listDeployedDrones: Handler<'listDeployedDronesResult'> = (ctx, msg) => {
    ctx.term.writeln('');
    if (msg.drones.length === 0) {
        ctx.term.writeln(render(PANEL.deployedDronesEmpty));
    } else {
        ctx.term.writeln(render(PANEL.deployedDronesHeader));
        for (const d of msg.drones) {
            ctx.term.writeln(
                render(PANEL.deployedDronesRow, { sector: d.sectorId, qty: d.quantity }),
            );
        }
    }
    showPrompt(ctx);
};
