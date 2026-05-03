import { ClientMsgType, PORT_CLASS_ACTIONS, type PortClassActions } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, TRANSACTION, PORT } from '../messages/index.js';
import { showCommerceReport, showSectorDisplay, type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import { type MenuArgsSlot } from '../menus/types.js';
import { askNumber, askConfirm } from '../menus/prompts.js';
import type { Handler } from './index.js';
import { fmt, refreshMinimap, type RefreshMinimapDeps } from './utils.js';

type PortDeps = Pick<GameContext, 'catalogs' | 'input' | 'io' | 'starbase' | 'world'> &
    DisplayCtx &
    DisplayPortCtx &
    DisplayStarbaseCtx &
    RefreshMinimapDeps &
    MenuArgsSlot;

export const dock: Handler<'dockResult', PortDeps> = (ctx, msg) => {
    if (!msg.docked || !msg.port) return;
    ctx.world.dockedPortInfo = msg.port;
    if (msg.port.class === 0) {
        if (msg.shipInfo) {
            ctx.starbase.class0ShipState = {
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
        ctx.io.term.writeln(render(PORT.class0Docking));
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

export const tradePrompt: Handler<'tradePrompt', PortDeps> = (ctx, msg) => {
    // Inline askNumber — tradeQty menu is gone. Server stays at 'port'
    // throughout the trade flow; this handler owns the qty prompt and
    // sends TradeResponse, after which the server emits the next
    // tradePrompt / tradeConfirmPrompt / tradeComplete envelope.
    void tradePromptAsk(ctx, msg);
};

async function tradePromptAsk(
    ctx: PortDeps,
    msg: {
        commodityLabel: string;
        action: 'buy' | 'sell';
        portTrading: number;
        onBoard: number;
        maxQty: number;
    },
): Promise<void> {
    const { term } = ctx.io;
    const infoTpl = msg.action === 'buy' ? PORT.tradeQtyInfoBuy : PORT.tradeQtyInfoSell;
    const promptTpl = msg.action === 'buy' ? PORT.tradeQtyPromptBuy : PORT.tradeQtyPromptSell;
    term.writeln('');
    term.writeln(render(infoTpl, { portTrading: msg.portTrading, onBoard: msg.onBoard }));
    const promptText = render(promptTpl, { commodity: msg.commodityLabel, maxQty: msg.maxQty });
    // Server contract: -1 means "default" (accept maxQty). Empty Enter
    // returns -1 here too; explicit 0 returns null (cancel) from
    // askNumber via the min: 1 guard, which we map to -1 cancel below.
    const qty = await askNumber(ctx, promptText, { defaultValue: -1, min: 0 });
    if (qty === null) {
        ctx.io.sendMsg({ type: ClientMsgType.TradeResponse, quantity: -1 });
        return;
    }
    ctx.io.sendMsg({ type: ClientMsgType.TradeResponse, quantity: qty });
}

export const tradeConfirmPrompt: Handler<'tradeConfirmPrompt', PortDeps> = (ctx, msg) => {
    void tradeConfirmAsk(ctx, msg);
};

async function tradeConfirmAsk(
    ctx: PortDeps,
    msg: { action: 'buy' | 'sell'; totalPrice: number },
): Promise<void> {
    const { term } = ctx.io;
    const tpl = msg.action === 'buy' ? TRANSACTION.tradeConfirmSell : TRANSACTION.tradeConfirmBuy;
    term.writeln(render(tpl, { total: fmt(msg.totalPrice) }));
    const ok = await askConfirm(ctx, render(TRANSACTION.tradeConfirmAccept), {
        defaultValue: true,
    });
    ctx.io.sendMsg({ type: ClientMsgType.TradeConfirmResponse, confirmed: ok === true });
}

export const tradeComplete: Handler<'tradeComplete', PortDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
};

export const tradeSkipped: Handler<'tradeSkipped', PortDeps> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(skipReasonTpl(msg.reason)));
};

export const undock: Handler<'undockResult', PortDeps> = (ctx, msg) => {
    if (msg.outcome === 'success') {
        ctx.world.dockedPortInfo = null;
        ctx.starbase.class0ShipState = null;
        ctx.world.sectorPlayers = msg.players;
        if (msg.tradeSkipReason) {
            ctx.io.term.writeln('');
            ctx.io.term.writeln(render(skipReasonTpl(msg.tradeSkipReason)));
        }
        refreshMinimap(ctx);
    } else {
        ctx.io.term.writeln(render(NOTIFY.error, { message: msg.message }));
    }
};

function skipReasonTpl(reason: import('@twnr/shared').TradeSkipReason): string {
    return reason === 'noTrade'
        ? PORT.noTrade
        : reason === 'insufficientTurns'
          ? PORT.skipInsufficientTurns
          : reason === 'insufficientCredits'
            ? PORT.skipInsufficientCredits
            : reason === 'insufficientPortInventory'
              ? PORT.skipInsufficientPortInventory
              : reason === 'insufficientCargoHolds'
                ? PORT.skipInsufficientCargoHolds
                : reason === 'insufficientCargo'
                  ? PORT.skipInsufficientCargo
                  : PORT.skipPortCannotBuy;
}

export const jettison: Handler<'jettisonResult', PortDeps> = (ctx, msg) => {
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
        ctx.io.term.writeln(render(TRANSACTION.jettisoned, { items: items || 'nothing' }));
    } else {
        ctx.io.term.writeln(render(NOTIFY.error, { message: msg.message }));
    }
};

export const portTransaction: Handler<'portTransactionResult', PortDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
};

export const dockStarbase: Handler<'dockStarbaseResult', PortDeps> = (ctx, msg) => {
    ctx.catalogs.hardwarePrices = msg.prices;
    if (msg.shipInfo) {
        ctx.starbase.class0ShipState = {
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
};

export const leaveStarbase: Handler<'leaveStarbaseResult', PortDeps> = (ctx, msg) => {
    ctx.starbase.class0ShipState = null;
    ctx.world.sectorPlayers = msg.players;
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
