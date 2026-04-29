import { ServerMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { TRANSACTION, SECTOR, PANEL } from '../messages/index.js';
import { showPrompt } from '../display.js';
import { showShipyardsMenu } from '../display-starbase.js';
import type { Handler } from './index.js';
import { fmt } from './utils.js';

export const shipInfo: Handler<'shipInfoResult'> = (ctx, msg) => {
    ctx.currentShipName = msg.shipName;
    ctx.currentColoredShipName = msg.coloredShipName;
    ctx.term.writeln('');
    ctx.term.writeln(render(SECTOR.playerInfoName, { name: ctx.playerName }));
    ctx.term.writeln(render(SECTOR.playerInfoSector, { sector: ctx.currentSector }));
    ctx.term.writeln(render(PANEL.shipName, { name: msg.coloredShipName ?? msg.shipName }));
    ctx.term.writeln(
        render(PANEL.shipDronesShields, {
            drones: msg.drones,
            maxDrones: msg.maxDrones,
            shields: msg.shields,
            maxShields: msg.maxShields,
        }),
    );
    ctx.term.writeln(
        render(PANEL.shipHolds, {
            free: msg.holdsAvailable,
            total: msg.cargoLimit,
            max: msg.maxHolds,
        }),
    );
    ctx.term.writeln(
        render(PANEL.shipCargo, {
            fuel: msg.cargoFuel,
            organics: msg.cargoOrganics,
            equipment: msg.cargoEquipment,
            colonists: msg.cargoColonists,
        }),
    );
    if (ctx.hardwareCatalog && ctx.hardwareCatalog.length > 0) {
        for (const item of ctx.hardwareCatalog) {
            const max = msg.hardwareMax[item.name];
            if (max === undefined || max === 0) {
                // Ship type can't carry this item — skip.
                continue;
            }
            const qty = msg.hardware[item.name] ?? 0;
            if (item.kind === 'toggle') {
                ctx.term.writeln(
                    render(
                        qty > 0 ? PANEL.shipHardwareRowToggleOn : PANEL.shipHardwareRowToggleOff,
                        { label: item.label.padEnd(18) },
                    ),
                );
            } else {
                ctx.term.writeln(
                    render(PANEL.shipHardwareRowStackable, {
                        label: item.label.padEnd(18),
                        qty,
                        max,
                    }),
                );
            }
        }
    }
    ctx.term.writeln(render(PANEL.shipCreditsTurns, { credits: msg.credits, turns: msg.turns }));
    ctx.term.writeln(render(PANEL.shipTurnsPerWarp, { turns: msg.turnsPerWarp }));
    if (ctx.mode === Menu.Sector) showPrompt(ctx);
};

function applyBuyShipResult(
    ctx: Parameters<Handler<'buyShipTradeinResult'>>[0],
    msg:
        | Parameters<Handler<'buyShipTradeinResult'>>[1]
        | Parameters<Handler<'buyShipNewResult'>>[1],
): void {
    ctx.currentShipName = msg.shipName;
    ctx.currentColoredShipName = msg.coloredShipName;
    const tpl =
        msg.type === ServerMsgType.BuyShipTradeinResult
            ? TRANSACTION.shipExchanged
            : TRANSACTION.shipPurchased;
    ctx.term.writeln(render(tpl, { name: msg.coloredShipName ?? msg.shipName }));
    ctx.term.writeln(render(TRANSACTION.shipCreditsLine, { credits: fmt(msg.credits) }));
    // Refresh class0ShipState so the next commerce report reflects the new
    // ship's max stats. The new ship starts empty (drones=0, shields=0);
    // current cargoLimit comes from the result, and maxHolds comes from the
    // catalog (server doesn't include it).
    if (ctx.class0ShipState) {
        const cfg = ctx.shipConfigs?.find((s) => s.name === msg.shipName);
        ctx.class0ShipState = {
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

export const buyShipTradein: Handler<'buyShipTradeinResult'> = applyBuyShipResult;
export const buyShipNew: Handler<'buyShipNewResult'> = applyBuyShipResult;
