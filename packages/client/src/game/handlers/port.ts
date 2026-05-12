import {
    ClientTag,
    Menu,
    PORT_CLASS_ACTIONS,
    ServerTag,
    type PortClassActions,
} from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, TRANSACTION, PORT } from '../messages/index.js';
import { showCommerceReport, showSectorDisplay, type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import { type MenuArgsSlot } from '../menus/types.js';
import { askNumber, askConfirm, awaitResponse } from '../menus/prompts.js';
import type { Handler } from './index.js';
import { fmt, refreshMinimap, type RefreshMinimapCtx } from './utils.js';

type PortContext = Pick<GameContext, 'catalogs' | 'input' | 'io' | 'starbase' | 'world'> &
    DisplayCtx &
    DisplayPortCtx &
    DisplayStarbaseCtx &
    RefreshMinimapCtx &
    MenuArgsSlot;

type Cargo = { fuel: number; organics: number; equipment: number; colonists: number };
type CommodityKey = keyof PortClassActions;

export const dock: Handler<'dockResult', PortContext> = (ctx, msg) => {
    if (!msg.docked || !msg.port) return;
    ctx.world.dockedPortInfo = msg.port;
    if (msg.port.class === 0) {
        ctx.world.mode = Menu.Class0;
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
    ctx.world.mode = Menu.Port;
    const actions = PORT_CLASS_ACTIONS[msg.port.class];
    if (!actions) return;
    const cargo: Cargo = msg.cargo ?? { fuel: 0, organics: 0, equipment: 0, colonists: 0 };
    const credits = msg.credits ?? 0;
    const emptyHolds = msg.emptyHolds ?? 0;
    const commodities: Array<{
        key: CommodityKey;
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
    void runTradeRoutine(ctx, actions, commodities, cargo, credits, emptyHolds);
};

async function runTradeRoutine(
    ctx: PortContext,
    actions: PortClassActions,
    commodities: Array<{
        key: CommodityKey;
        label: string;
        trading: number;
        max: number;
        onBoard: number;
    }>,
    initialCargo: Cargo,
    initialCredits: number,
    initialEmptyHolds: number,
): Promise<void> {
    const { term } = ctx.io;
    // Local mirror of state that changes as trades complete. Each
    // PortTransactionResult re-syncs cargo/credits/emptyHolds; port
    // inventory we decrement locally (only this player trades during
    // their dock session).
    const portInv: Record<CommodityKey, number> = {
        fuel: commodities[0].trading,
        organics: commodities[1].trading,
        equipment: commodities[2].trading,
    };
    let cargo: Cargo = { ...initialCargo };
    let credits = initialCredits;
    let emptyHolds = initialEmptyHolds;

    let prompted = false;

    const ordered = [
        ...commodities.filter((c) => actions[c.key] === 'B'), // player sells
        ...commodities.filter((c) => actions[c.key] === 'S'), // player buys
    ];

    for (const c of ordered) {
        const action: 'buy' | 'sell' = actions[c.key] === 'S' ? 'buy' : 'sell';
        const price =
            c.key === 'fuel'
                ? (ctx.world.dockedPortInfo?.fuelPrice ?? 0)
                : c.key === 'organics'
                  ? (ctx.world.dockedPortInfo?.orgPrice ?? 0)
                  : (ctx.world.dockedPortInfo?.equPrice ?? 0);
        const portTrading = portInv[c.key];
        const onBoard = cargo[c.key];
        const maxQty =
            action === 'buy' ? Math.min(emptyHolds, portTrading) : Math.min(onBoard, portTrading);
        if (maxQty <= 0) continue;
        prompted = true;

        const infoTpl = action === 'buy' ? PORT.tradeQtyInfoBuy : PORT.tradeQtyInfoSell;
        const promptTpl = action === 'buy' ? PORT.tradeQtyPromptBuy : PORT.tradeQtyPromptSell;
        term.writeln('');
        term.writeln(render(infoTpl, { portTrading, onBoard }));
        const promptText = render(promptTpl, { commodity: c.label, maxQty });

        const raw = await askNumber(ctx, promptText, { defaultValue: -1, min: 0 });
        if (ctx.world.mode !== Menu.Port) return;

        const qty = raw === null || raw < 0 ? maxQty : Math.min(raw, maxQty);
        if (qty <= 0) continue;

        const totalPrice = qty * price;
        const confirmTpl =
            action === 'buy' ? TRANSACTION.tradeConfirmSell : TRANSACTION.tradeConfirmBuy;
        term.writeln(render(confirmTpl, { total: fmt(totalPrice) }));
        const ok = await askConfirm(ctx, render(TRANSACTION.tradeConfirmAccept), {
            defaultValue: true,
        });
        if (ctx.world.mode !== Menu.Port) return;
        if (ok !== true) continue;

        ctx.io.sendMsg({
            type: ClientTag.PortTransaction,
            good: c.key,
            quantity: qty,
            action,
        });
        const response = await awaitResponse(ctx, [
            ServerTag.PortTransactionResult,
            ServerTag.Error,
        ]);
        if (response === null) return;
        if (response.type !== ServerTag.PortTransactionResult) {
            return;
        }

        cargo = response.cargo;
        credits = response.credits;
        emptyHolds = response.emptyHolds;
        portInv[c.key] = Math.max(0, portInv[c.key] - qty);
        term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(credits) }));
    }

    if (!prompted) {
        term.writeln('');
        term.writeln(render(PORT.noTrade));
    }
    ctx.io.sendMsg({ type: ClientTag.Undock });
}

export const undock: Handler<'undockResult', PortContext> = (ctx, msg) => {
    if (msg.outcome === 'success') ctx.world.mode = Menu.Sector;
    if (msg.outcome === 'success') {
        ctx.world.dockedPortInfo = null;
        ctx.starbase.class0ShipState = null;
        ctx.world.sectorPlayers = msg.players;
        refreshMinimap(ctx);
    } else {
        ctx.io.term.writeln(render(NOTIFY.error, { message: msg.message }));
    }
};

export const jettison: Handler<'jettisonResult', PortContext> = (ctx, msg) => {
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

export const dockStarbase: Handler<'dockStarbaseResult', PortContext> = (ctx, msg) => {
    ctx.world.mode = Menu.Starbase;
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

export const leaveStarbase: Handler<'leaveStarbaseResult', PortContext> = (ctx, msg) => {
    ctx.world.mode = Menu.Sector;
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
        msg.sectorMines,
    );
    refreshMinimap(ctx);
};
