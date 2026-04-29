import { ServerMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { TRANSACTION, SECTOR, PANEL } from '../messages/index.js';
import { showPrompt, type DisplayCtx } from '../display.js';
import { showShipyardsMenu, type DisplayStarbaseCtx } from '../display-starbase.js';
import type { Handler } from './index.js';
import { fmt } from './utils.js';

type ShipExchangeDeps = Pick<
    GameContext,
    'catalogs' | 'io' | 'player' | 'ship' | 'starbase' | 'world'
> &
    DisplayCtx &
    DisplayStarbaseCtx;

export const shipInfo: Handler<'shipInfoResult', ShipExchangeDeps> = (ctx, msg) => {
    ctx.ship.currentShipName = msg.shipName;
    ctx.ship.currentColoredShipName = msg.coloredShipName;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(SECTOR.playerInfoName, { name: ctx.player.name }));
    ctx.io.term.writeln(render(SECTOR.playerInfoSector, { sector: ctx.world.currentSector }));
    ctx.io.term.writeln(render(PANEL.shipName, { name: msg.coloredShipName ?? msg.shipName }));
    ctx.io.term.writeln(
        render(PANEL.shipDronesShields, {
            drones: msg.drones,
            maxDrones: msg.maxDrones,
            shields: msg.shields,
            maxShields: msg.maxShields,
        }),
    );
    ctx.io.term.writeln(
        render(PANEL.shipHolds, {
            free: msg.holdsAvailable,
            total: msg.cargoLimit,
            max: msg.maxHolds,
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
                // Ship type can't carry this item — skip.
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
    ctx.io.term.writeln(render(PANEL.shipCreditsTurns, { credits: msg.credits, turns: msg.turns }));
    ctx.io.term.writeln(render(PANEL.shipTurnsPerWarp, { turns: msg.turnsPerWarp }));
    if (ctx.world.mode === Menu.Sector) showPrompt(ctx);
};

function applyBuyShipResult(
    ctx: ShipExchangeDeps,
    msg:
        | Parameters<Handler<'buyShipTradeinResult'>>[1]
        | Parameters<Handler<'buyShipNewResult'>>[1],
): void {
    ctx.ship.currentShipName = msg.shipName;
    ctx.ship.currentColoredShipName = msg.coloredShipName;
    const tpl =
        msg.type === ServerMsgType.BuyShipTradeinResult
            ? TRANSACTION.shipExchanged
            : TRANSACTION.shipPurchased;
    ctx.io.term.writeln(render(tpl, { name: msg.coloredShipName ?? msg.shipName }));
    ctx.io.term.writeln(render(TRANSACTION.shipCreditsLine, { credits: fmt(msg.credits) }));
    // Refresh class0ShipState so the next commerce report reflects the new
    // ship's max stats. The new ship starts empty (drones=0, shields=0);
    // current cargoLimit comes from the result, and maxHolds comes from the
    // catalog (server doesn't include it).
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
    showShipyardsMenu(ctx);
}

export const buyShipTradein: Handler<'buyShipTradeinResult', ShipExchangeDeps> = applyBuyShipResult;
export const buyShipNew: Handler<'buyShipNewResult', ShipExchangeDeps> = applyBuyShipResult;
