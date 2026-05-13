import { ServerTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { TRANSACTION, SECTOR, PANEL } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import type { Handler } from './index.js';
import { fmt } from './utils.js';

type ShipExchangeContext = Pick<
    GameContext,
    'catalogs' | 'io' | 'player' | 'ship' | 'starbase' | 'world'
> &
    DisplayCtx &
    DisplayStarbaseCtx;

export const shipInfo: Handler<'shipInfoResult', ShipExchangeContext> = (ctx, msg) => {
    ctx.ship.currentShipName = msg.shipName;
    ctx.ship.currentColoredShipName = msg.coloredShipName;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(SECTOR.playerInfoName, { name: ctx.player.name }));
    ctx.io.term.writeln(render(SECTOR.playerInfoSector, { sector: ctx.world.currentSector }));
    ctx.io.term.writeln(render(PANEL.shipName, { name: msg.coloredShipName ?? msg.shipName }));
    if (msg.clanNumber !== null) {
        ctx.io.term.writeln(
            render(PANEL.shipClan, { num: msg.clanNumber, name: msg.clanName ?? '' }),
        );
    }
    // Pad the X side and Y side independently so all "X / Y" pairs line
    // up vertically across rows.
    const vals = [
        msg.drones,
        msg.maxDrones,
        msg.shields,
        msg.maxShields,
        msg.holdsAvailable,
        msg.cargoLimit,
        msg.maxHolds,
    ];
    const w = Math.max(...vals.map((n) => String(n).length));
    const padL = (n: number) => String(n).padStart(w);
    ctx.io.term.writeln(
        render(PANEL.shipDronesShields, {
            drones: padL(msg.drones),
            maxDrones: padL(msg.maxDrones),
            shields: padL(msg.shields),
            maxShields: padL(msg.maxShields),
        }),
    );
    ctx.io.term.writeln(
        render(PANEL.shipHolds, {
            free: padL(msg.holdsAvailable),
            total: padL(msg.cargoLimit),
            max: padL(msg.maxHolds),
        }),
    );
    ctx.io.term.writeln(
        render(PANEL.shipCargo, {
            fuel: msg.cargoFuel,
            organics: msg.cargoOrganics,
            equipment: msg.cargoEquipment,
            colonists: msg.cargoColonists,
        }),
    );
    if (ctx.catalogs.hardware && ctx.catalogs.hardware.length > 0) {
        for (const item of ctx.catalogs.hardware) {
            const max = msg.hardwareMax[item.name];
            if (max === undefined || max === 0) {
                // Ship type can't carry this item
                continue;
            }
            const qty = msg.hardware[item.name] ?? 0;
            if (item.kind === 'toggle') {
                ctx.io.term.writeln(
                    render(
                        qty > 0 ? PANEL.shipHardwareRowToggleOn : PANEL.shipHardwareRowToggleOff,
                        { label: item.label.padEnd(18) },
                    ),
                );
            } else {
                ctx.io.term.writeln(
                    render(PANEL.shipHardwareRowStackable, {
                        label: item.label.padEnd(18),
                        qty,
                        max,
                    }),
                );
            }
        }
    }
    ctx.io.term.writeln(
        render(PANEL.shipCreditsTurns, {
            credits: fmt(msg.credits),
            turns: msg.turns,
        }),
    );
    ctx.io.term.writeln(render(PANEL.shipTurnsPerWarp, { turns: msg.turnsPerWarp }));
};

function applyBuyShipResult(
    ctx: ShipExchangeContext,
    msg:
        | Parameters<Handler<'buyShipTradeinResult'>>[1]
        | Parameters<Handler<'buyShipNewResult'>>[1],
): void {
    ctx.ship.currentShipName = msg.shipName;
    ctx.ship.currentColoredShipName = msg.coloredShipName;
    const tpl =
        msg.type === ServerTag.BuyShipTradeinResult
            ? TRANSACTION.shipExchanged
            : TRANSACTION.shipPurchased;
    ctx.io.term.writeln(render(tpl, { name: msg.coloredShipName ?? msg.shipName }));
    ctx.io.term.writeln(render(TRANSACTION.shipCreditsLine, { credits: fmt(msg.credits) }));
    // Refresh class0ShipState
    if (ctx.starbase.class0ShipState) {
        const cfg = ctx.catalogs.ships?.find((s) => s.name === msg.shipName);
        ctx.starbase.class0ShipState = {
            shipName: msg.shipName,
            credits: msg.credits,
            drones: 0,
            maxDrones: msg.maxDrones,
            shields: 0,
            maxShields: msg.maxShields,
            holds: msg.cargoLimit,
            maxHolds: cfg?.max_holds ?? msg.cargoLimit,
        };
    }
}

export const buyShipTradein: Handler<'buyShipTradeinResult', ShipExchangeContext> =
    applyBuyShipResult;
export const buyShipNew: Handler<'buyShipNewResult', ShipExchangeContext> = applyBuyShipResult;
