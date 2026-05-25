import {
    ClientTag,
    Menu,
    PORT_CLASS_ACTIONS,
    ServerTag,
    type PortClassActions,
    type ServerEnvelope as ServerEnvelopeT,
} from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT, NOTIFY, TRANSACTION, PORT } from '../messages/index.js';
import { showCommerceReport, showSectorDisplay, type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import { type MenuArgsSlot } from '../routines/types.js';
import { askNumber, awaitResponse } from '../routines/prompts.js';
import type { Handler } from './index.js';
import { fmt, refreshMinimap, renderAttributeChange, type RefreshMinimapCtx } from './utils.js';

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
    if (msg.freedFromTow) ctx.io.term.writeln(render(EVENT.towFreedByDock));
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
    return runTradeRoutine(ctx, actions, commodities, cargo, credits, emptyHolds);
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

        // Haggle session: open with quantity, then loop counters until the
        // port accepts, rejects, or the player walks.
        ctx.io.sendMsg({
            type: ClientTag.HaggleOpen,
            commodity: c.key,
            quantity: qty,
            action,
        });
        const opened = await awaitResponse(ctx, [ServerTag.HaggleOpenResult, ServerTag.Error]);
        if (opened === null) return;
        if (opened.type !== ServerTag.HaggleOpenResult || opened.outcome !== 'opened') {
            const msg =
                opened.type === ServerTag.HaggleOpenResult && opened.outcome === 'error'
                    ? opened.message
                    : 'Haggle could not start';
            term.writeln(msg);
            continue;
        }

        term.writeln('');
        term.writeln(`Agreed, ${qty} units.`);
        term.writeln('');
        const verb = action === 'buy' ? "We'll sell them for" : "We'll buy them for";
        term.writeln(`${verb} ${fmt(opened.initialOffer)} credits.`);
        let portCurrent = opened.initialOffer;
        let isFinal = false;
        let settled: typeof response | null = null;
        type HaggleResp = Extract<ServerEnvelopeT, { type: typeof ServerTag.HaggleResponseResult }>;
        let response: HaggleResp | null = null;

        while (!settled) {
            const counter = await askNumber(ctx, `Your offer [${portCurrent}] ? `, {
                defaultValue: portCurrent,
                min: 0,
            });
            if (ctx.world.mode !== Menu.Port) return;
            if (counter === null) {
                ctx.io.sendMsg({ type: ClientTag.HaggleQuit });
                term.writeln('');
                term.writeln('You walk away from the deal.');
                break;
            }
            // Player accepts the port's current offer (default = press enter).
            if (
                counter === portCurrent ||
                (isFinal && counter >= portCurrent && action === 'buy') ||
                (isFinal && counter <= portCurrent && action === 'sell')
            ) {
                ctx.io.sendMsg({ type: ClientTag.HaggleAccept });
            } else if (isFinal) {
                // After final offer the only valid input is accept or quit.
                ctx.io.sendMsg({ type: ClientTag.HaggleQuit });
                term.writeln('');
                term.writeln('You walk away from the deal.');
                break;
            } else {
                ctx.io.sendMsg({ type: ClientTag.HaggleCounter, counter });
            }

            const r = await awaitResponse(ctx, [ServerTag.HaggleResponseResult, ServerTag.Error]);
            if (r === null) return;
            if (r.type !== ServerTag.HaggleResponseResult) {
                term.writeln('Haggle error');
                break;
            }
            response = r as HaggleResp;
            if (response.outcome === 'accepted') {
                settled = response;
                term.writeln("You are a shrewd trader, they're all yours.");
            } else if (response.outcome === 'counter') {
                portCurrent = response.newPortOffer;
                term.writeln('');
                term.writeln(`${verb} ${fmt(portCurrent)} credits.`);
            } else if (response.outcome === 'final') {
                portCurrent = response.newPortOffer;
                isFinal = true;
                term.writeln('');
                term.writeln(`Our final offer is ${fmt(portCurrent)} credits.`);
            } else if (response.outcome === 'rejected') {
                term.writeln('');
                term.writeln('This conversation is terminated!');
                break;
            } else {
                term.writeln(response.message);
                break;
            }
        }

        if (settled) {
            cargo = settled.cargo;
            credits = settled.credits;
            emptyHolds = settled.emptyHolds;
            portInv[c.key] =
                action === 'buy'
                    ? Math.max(0, portInv[c.key] - qty)
                    : Math.max(0, portInv[c.key] - qty);
            term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(credits) }));
            renderAttributeChange(ctx, settled.expDelta ?? 0, settled.repDelta ?? 0, 'trading');
        }
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
        renderAttributeChange(
            ctx,
            msg.expDelta ?? 0,
            msg.repDelta ?? 0,
            'jettisoning colonists',
        );
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
    showSectorDisplay(ctx, msg);
    refreshMinimap(ctx);
};
