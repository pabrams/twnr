import { ClientMsgType, Menu, type ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import {
    showStarbaseMenu,
    showStarbaseHelp,
    showStarbasePrompt,
    showHardwareMenu,
    showHardwareHelp,
    showHardwarePrompt,
    showBuyQtyPrompt,
    showShipyardsMenu,
    showShipyardsHelp,
    showShipyardsPrompt,
    showShipBuyList,
    showShipExamineList,
    showTradeinPrompt,
    showShipyardsClass0Menu,
    showShipyardsClass0QtyPrompt,
    letterToIndex,
} from './display-starbase.js';
import { showShipDetail } from './display-computer.js';
import { colors } from './constants.js';

export function handleStarbaseInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 's':
            ctx.changeMenu(Menu.Shipyards);
            showShipyardsMenu(ctx);
            break;
        case 'h':
            ctx.changeMenu(Menu.StarbaseHardware);
            showHardwareMenu(ctx);
            break;
        case '?':
            showStarbaseHelp(ctx);
            break;
        case 'q':
            ctx.sendMsg({ type: ClientMsgType.LeaveStarbase });
            break;
        default:
            showStarbasePrompt(ctx);
    }
}

// Map hardware menu keys to item names and labels for quantity-based purchases
const STACKABLE_HARDWARE: Record<string, { itemName: string; label: string }> = {
    t: { itemName: 'terraform_device', label: 'Terraform Devices' },
    b: { itemName: 'planet_buster', label: 'Planet Busters' },
    u: { itemName: 'buoy', label: 'Space Buoys' },
    p: { itemName: 'proximity_mine', label: 'Proximity Mines' },
    s: { itemName: 'seeker_mine', label: 'Seeker Mines' },
    o: { itemName: 'orbital_mine', label: 'Orbital Mines' },
    d: { itemName: 'mine_disruptor', label: 'Mine Disruptors' },
    k: { itemName: 'cloaking_device', label: 'Cloaking Devices' },
    c: { itemName: 'corbomite', label: 'Corbomite' },
    h: { itemName: 'photon_torpedo', label: 'Photon Torpedoes' },
    r: { itemName: 'recon_drone', label: 'Recon Drones' },
};

export function handleHardwareInput(ctx: GameContext, line: string) {
    const key = line.toLowerCase();
    // Toggle hardware (no quantity needed)
    if (key === '1') {
        ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'hyperspace_1' });
        return;
    }
    if (key === '2') {
        ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'hyperspace_2' });
        return;
    }
    if (key === 'v') {
        ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'visual_scanner' });
        return;
    }
    if (key === 'n') {
        ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName: 'planet_scanner' });
        return;
    }
    // Stackable hardware (needs quantity)
    const hw = STACKABLE_HARDWARE[key];
    if (hw) {
        ctx.starbaseBuyItemName = hw.itemName;
        ctx.changeMenu(Menu.StarbaseBuyQty);
        showBuyQtyPrompt(ctx, hw.label);
        return;
    }
    if (key === '?') {
        showHardwareHelp(ctx);
        return;
    }
    if (key === 'q') {
        ctx.changeMenu(Menu.Starbase);
        showStarbaseMenu(ctx);
        return;
    }
    showHardwarePrompt(ctx);
}

export function handleStarbaseBuyQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.StarbaseHardware);
        showHardwareMenu(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    const itemName = ctx.starbaseBuyItemName;
    if (itemName) {
        ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName, quantity: qty });
    }
}

export function handlePlanetSelectInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Sector);
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    const planets = ctx.landablePlanets;
    if (planets && idx >= 0 && idx < planets.length) {
        ctx.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: planets[idx].id });
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handleHyperspaceJumpInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Computer);
        return;
    }
    const sector = parseInt(line, 10);
    if (isNaN(sector) || sector <= 0) {
        ctx.term.writeln('Enter a valid sector number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.HyperspaceJump, targetSector: sector });
}

// --- Shipyards ---

function calculateShipPrice(ship: ShipCatalogEntry): number {
    return (
        (ship.cost_drive ?? 0) +
        (ship.cost_computer ?? 0) +
        (ship.cost_hull ?? 0) +
        (ship.starting_holds ?? 0) * (ship.hold_cost ?? 0)
    );
}

function getCurrentShipPrice(ctx: GameContext): number {
    if (!ctx.shipConfigs || !ctx.currentShipName) return 0;
    const ship = ctx.shipConfigs.find((s) => s.name === ctx.currentShipName);
    return ship ? calculateShipPrice(ship) : 0;
}

export function handleShipyardsInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'b':
            showShipBuyList(ctx);
            break;
        case 'e':
            showShipExamineList(ctx);
            break;
        case 'p':
            showShipyardsClass0Menu(ctx);
            break;
        case '?':
            showShipyardsHelp(ctx);
            break;
        case 'q':
            ctx.changeMenu(Menu.Starbase);
            showStarbaseMenu(ctx);
            break;
        default:
            showShipyardsPrompt(ctx);
    }
}

export function handleShipyardsBuyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Shipyards);
        showShipyardsMenu(ctx);
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        const ship = ctx.shipConfigs[idx];
        if (ship.name === ctx.currentShipName) {
            ctx.term.writeln(colors.boldRed('Already flying that ship.'));
            return;
        }
        const price = calculateShipPrice(ship);
        const tradeinCredit = getCurrentShipPrice(ctx);
        ctx.shipyardsBuyTarget = ship.name;
        showTradeinPrompt(ctx, ship.name, price, tradeinCredit);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handleShipyardsTradeinInput(ctx: GameContext, line: string) {
    const targetShipName = ctx.shipyardsBuyTarget;
    if (!targetShipName) {
        ctx.changeMenu(Menu.Shipyards);
        showShipyardsMenu(ctx);
        return;
    }
    switch (line.toLowerCase()) {
        case 'y':
            ctx.sendMsg({ type: ClientMsgType.BuyShipTradein, targetShipName });
            break;
        case 'n':
            ctx.sendMsg({ type: ClientMsgType.BuyShipNew, targetShipName });
            break;
        case 'q':
            showShipBuyList(ctx);
            break;
        default:
            ctx.term.write(`${colors.cyan('Trade in?')} (Y/N/Q) `);
    }
}

export function handleShipyardsExamineInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Shipyards);
        showShipyardsMenu(ctx);
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        showShipDetail(ctx, ctx.shipConfigs[idx]);
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handleShipyardsClass0Input(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'f':
            ctx.class0BuyType = 'drones';
            showShipyardsClass0QtyPrompt(ctx, 'drones');
            break;
        case 's':
            ctx.class0BuyType = 'shields';
            showShipyardsClass0QtyPrompt(ctx, 'shields');
            break;
        case 'h':
            ctx.class0BuyType = 'holds';
            showShipyardsClass0QtyPrompt(ctx, 'holds');
            break;
        case 'q':
            ctx.changeMenu(Menu.Shipyards);
            showShipyardsMenu(ctx);
            break;
        default:
            showShipyardsClass0Menu(ctx);
    }
}

export function handleShipyardsClass0QtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        showShipyardsClass0Menu(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    switch (ctx.class0BuyType) {
        case 'drones':
            ctx.sendMsg({ type: ClientMsgType.BuyDrones, quantity: qty });
            break;
        case 'shields':
            ctx.sendMsg({ type: ClientMsgType.BuyShields, quantity: qty });
            break;
        case 'holds':
            ctx.sendMsg({ type: ClientMsgType.BuyHolds, quantity: qty });
            break;
    }
}
