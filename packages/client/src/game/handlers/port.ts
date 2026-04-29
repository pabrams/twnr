import { PORT_CLASS_ACTIONS, type PortClassActions } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, TRANSACTION, PORT } from '../messages/index.js';
import { showCommerceReport, showPrompt, showSectorDisplay } from '../display.js';
import { showClass0Menu, showTradeQtyPrompt } from '../display-port.js';
import { showStarbaseMenu } from '../display-starbase.js';
import type { Handler } from './index.js';
import { fmt, refreshMinimap } from './utils.js';

export const dock: Handler<'dockResult'> = (ctx, msg) => {
    if (!msg.docked || !msg.port) return;
    ctx.dockedPortInfo = msg.port;
    if (msg.port.class === 0) {
        if (msg.shipInfo) {
            ctx.class0ShipState = {
                shipName: msg.shipInfo.shipName,
                credits: msg.credits ?? 0,
                drones: msg.shipInfo.drones,
                maxDrones: msg.shipInfo.maxDrones,
                shields: msg.shipInfo.shields,
                maxShields: msg.shipInfo.maxShields,
                holds: msg.shipInfo.holds,
                maxHolds: msg.shipInfo.maxHolds,
            };
        }
        showClass0Menu(ctx, true);
        return;
    }
    const actions = PORT_CLASS_ACTIONS[msg.port.class];
    if (!actions) return;
    const cargo = msg.cargo ?? { fuel: 0, organics: 0, equipment: 0, colonists: 0 };
    const credits = msg.credits ?? 0;
    const emptyHolds = msg.emptyHolds ?? 0;
    const commodities: Array<{
        key: keyof PortClassActions;
        label: string;
        trading: number;
        max: number;
        onBoard: number;
    }> = [
        {
            key: 'fuel',
            label: 'Fuel',
            trading: msg.port.fuel,
            max: msg.port.fuelMax,
            onBoard: cargo.fuel,
        },
        {
            key: 'organics',
            label: 'Organics',
            trading: msg.port.organics,
            max: msg.port.orgMax,
            onBoard: cargo.organics,
        },
        {
            key: 'equipment',
            label: 'Equipment',
            trading: msg.port.equipment,
            max: msg.port.equMax,
            onBoard: cargo.equipment,
        },
    ];
    showCommerceReport(
        ctx,
        msg.port.portName,
        msg.port.class,
        commodities.map((c) => ({
            name: c.label,
            key: c.key,
            status: actions[c.key] === 'B' ? 'Buying' : 'Selling',
            trading: c.trading,
            max: c.max,
            onBoard: c.onBoard,
        })),
        credits,
        emptyHolds,
    );
};

export const tradePrompt: Handler<'tradePrompt'> = (ctx, msg) => {
    showTradeQtyPrompt(
        ctx,
        msg.commodityLabel,
        msg.action,
        msg.portTrading,
        msg.onBoard,
        msg.maxQty,
    );
};

export const tradeConfirmPrompt: Handler<'tradeConfirmPrompt'> = (ctx, msg) => {
    const tpl = msg.action === 'buy' ? TRANSACTION.tradeConfirmSell : TRANSACTION.tradeConfirmBuy;
    ctx.term.writeln(render(tpl, { total: fmt(msg.totalPrice) }));
    ctx.term.write(render(TRANSACTION.tradeConfirmAccept));
};

export const tradeComplete: Handler<'tradeComplete'> = (ctx, msg) => {
    ctx.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
};

export const tradeSkipped: Handler<'tradeSkipped'> = (ctx, msg) => {
    const tpl =
        msg.reason === 'noTrade'
            ? PORT.noTrade
            : msg.reason === 'insufficientTurns'
              ? PORT.skipInsufficientTurns
              : msg.reason === 'insufficientCredits'
                ? PORT.skipInsufficientCredits
                : msg.reason === 'insufficientPortInventory'
                  ? PORT.skipInsufficientPortInventory
                  : msg.reason === 'insufficientCargoHolds'
                    ? PORT.skipInsufficientCargoHolds
                    : msg.reason === 'insufficientCargo'
                      ? PORT.skipInsufficientCargo
                      : PORT.skipPortCannotBuy;
    ctx.term.writeln('');
    ctx.term.writeln(render(tpl));
};

export const undock: Handler<'undockResult'> = (ctx, msg) => {
    if (msg.outcome === 'success') {
        ctx.dockedPortInfo = null;
        ctx.class0ShipState = null;
        ctx.sectorPlayers = msg.players;
        refreshMinimap(ctx);
        showPrompt(ctx);
    } else {
        ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
    }
};

export const jettison: Handler<'jettisonResult'> = (ctx, msg) => {
    if (msg.outcome === 'success') {
        const j = msg.jettisoned;
        const items = [
            j.fuel > 0 ? `${j.fuel} fuel` : '',
            j.organics > 0 ? `${j.organics} organics` : '',
            j.equipment > 0 ? `${j.equipment} equipment` : '',
            j.colonists > 0 ? `${j.colonists} colonists` : '',
        ]
            .filter(Boolean)
            .join(', ');
        ctx.term.writeln(render(TRANSACTION.jettisoned, { items: items || 'nothing' }));
    } else {
        ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
    }
    showPrompt(ctx);
};

export const portTransaction: Handler<'portTransactionResult'> = (ctx, msg) => {
    ctx.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
};

export const dockStarbase: Handler<'dockStarbaseResult'> = (ctx, msg) => {
    ctx.hardwarePrices = msg.prices;
    if (msg.shipInfo) {
        ctx.class0ShipState = {
            shipName: msg.shipInfo.shipName,
            credits: msg.credits ?? 0,
            drones: msg.shipInfo.drones,
            maxDrones: msg.shipInfo.maxDrones,
            shields: msg.shipInfo.shields,
            maxShields: msg.shipInfo.maxShields,
            holds: msg.shipInfo.holds,
            maxHolds: msg.shipInfo.maxHolds,
        };
    }
    showStarbaseMenu(ctx);
};

export const leaveStarbase: Handler<'leaveStarbaseResult'> = (ctx, msg) => {
    ctx.class0ShipState = null;
    ctx.sectorPlayers = msg.players;
    showSectorDisplay(
        ctx,
        msg.sector,
        msg.warps,
        msg.players,
        msg.port,
        msg.sectorDrones,
        msg.planets,
        msg.ships,
        msg.collisions,
    );
    refreshMinimap(ctx);
};
