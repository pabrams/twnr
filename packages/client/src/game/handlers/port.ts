import { PORT_CLASS_ACTIONS, Menu, type PortClassActions } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, TRANSACTION, PORT } from '../messages/index.js';
import { showCommerceReport, showSectorDisplay, type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import { setMenuArgs, type MenuArgsSlot } from '../menus/types.js';
import type { Handler } from './index.js';
import { fmt, refreshMinimap, type RefreshMinimapDeps } from './utils.js';

type PortDeps = Pick<GameContext, 'catalogs' | 'io' | 'starbase' | 'world'> &
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
    setMenuArgs(ctx, {
        menu: Menu.TradeQty,
        commodity: msg.commodityLabel,
        action: msg.action,
        portTrading: msg.portTrading,
        onBoard: msg.onBoard,
        maxQty: msg.maxQty,
    });
};

export const tradeConfirmPrompt: Handler<'tradeConfirmPrompt', PortDeps> = (ctx, msg) => {
    setMenuArgs(ctx, {
        menu: Menu.TradeConfirm,
        action: msg.action,
        totalPrice: msg.totalPrice,
    });
};

export const tradeComplete: Handler<'tradeComplete', PortDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
};

export const tradeSkipped: Handler<'tradeSkipped', PortDeps> = (ctx, msg) => {
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
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(tpl));
};

export const undock: Handler<'undockResult', PortDeps> = (ctx, msg) => {
    if (msg.outcome === 'success') {
        ctx.world.dockedPortInfo = null;
        ctx.starbase.class0ShipState = null;
        ctx.world.sectorPlayers = msg.players;
        refreshMinimap(ctx);
    } else {
        ctx.io.term.writeln(render(NOTIFY.error, { message: msg.message }));
    }
};

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
