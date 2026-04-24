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
    showHardwareItemDetail,
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
import { showShipDetail, showShipInterestPrompt } from './display-computer.js';
import { class0MaxBuy, showClass0Menu } from './display-port.js';
import { render } from './renderer.js';
import { NOTIFY, COMMON } from './messages/index.js';

export function handleStarbaseInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 's':
            ctx.changeMenu(Menu.Shipyards);
            showShipyardsMenu(ctx);
            break;
        case 'h':
            ctx.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
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

const TOGGLE_HARDWARE: Record<string, string> = {
    '1': 'hyperspace_1',
    '2': 'hyperspace_2',
    v: 'visual_scanner',
    n: 'planet_scanner',
};

export function handleHardwareInput(ctx: GameContext, line: string) {
    const key = line.toLowerCase();

    // Toggle hardware (no quantity step): show detail, then fire buy.
    const toggleItem = TOGGLE_HARDWARE[key];
    if (toggleItem) {
        showHardwareItemDetail(ctx, toggleItem);
        ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName: toggleItem });
        return;
    }

    // Stackable hardware: show detail, then transition to qty prompt with default max.
    const hw = STACKABLE_HARDWARE[key];
    if (hw) {
        const canBuy = showHardwareItemDetail(ctx, hw.itemName);
        if (canBuy <= 0) {
            // Nothing to buy (no capacity or no credits) — stay in the hardware menu.
            showHardwarePrompt(ctx);
            return;
        }
        ctx.starbaseBuyItemName = hw.itemName;
        ctx.starbaseBuyDefault = canBuy;
        ctx.changeMenu(Menu.StarbaseBuyQty);
        showBuyQtyPrompt(ctx, hw.label, canBuy);
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
    const trimmed = line.trim();
    // Q or 0 cancels back to the hardware menu.
    if (trimmed.toLowerCase() === 'q' || trimmed === '0') {
        ctx.changeMenu(Menu.StarbaseHardware);
        showHardwareMenu(ctx);
        return;
    }
    // Empty Enter → accept default (max we can buy). If the default is 0, cancel.
    const qty = trimmed === '' ? ctx.starbaseBuyDefault : parseInt(trimmed, 10);
    if (qty === 0) {
        ctx.changeMenu(Menu.StarbaseHardware);
        showHardwareMenu(ctx);
        return;
    }
    if (isNaN(qty) || qty < 0) {
        ctx.term.writeln('Enter a non-negative number (0 to cancel).');
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
        ctx.term.writeln(render(NOTIFY.invalidSelection));
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
            ctx.term.writeln(render(COMMON.errorLine, { text: 'Already flying that ship.' }));
            return;
        }
        const price = calculateShipPrice(ship);
        const tradeinCredit = getCurrentShipPrice(ctx);
        ctx.shipyardsBuyTarget = ship.name;
        showTradeinPrompt(ctx, ship.display_name ?? ship.name, price, tradeinCredit);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
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
            ctx.term.write(render('[c]Trade in?[/c] (Y/N/Q) '));
    }
}

export function handleShipyardsExamineInput(ctx: GameContext, line: string) {
    const lower = line.toLowerCase();
    if (lower === 'q') {
        ctx.changeMenu(Menu.Shipyards);
        showShipyardsMenu(ctx);
        return;
    }
    if (lower === '?') {
        showShipExamineList(ctx);
        showShipInterestPrompt(ctx);
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        showShipDetail(ctx, ctx.shipConfigs[idx]);
        showShipInterestPrompt(ctx);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
        showShipInterestPrompt(ctx);
    }
}

export function handleShipyardsClass0Input(ctx: GameContext, line: string) {
    const choose = (kind: 'drones' | 'shields' | 'holds') => {
        ctx.class0BuyType = kind;
        showShipyardsClass0QtyPrompt(ctx, kind);
    };
    switch (line.toLowerCase()) {
        case 'a':
            choose('holds');
            break;
        case 'b':
            choose('drones');
            break;
        case 'c':
            choose('shields');
            break;
        case 'q':
            ctx.changeMenu(Menu.Shipyards);
            showShipyardsMenu(ctx);
            break;
        case '?':
        default:
            showClass0Menu(ctx);
    }
}

export function handleShipyardsClass0QtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'q') {
        showShipyardsClass0Menu(ctx);
        return;
    }
    const kind = ctx.class0BuyType;
    if (!kind) return;
    const max = class0MaxBuy(kind, ctx);
    const qty = trimmed === '' ? max : parseInt(trimmed, 10);
    if (isNaN(qty) || qty < 0) {
        ctx.term.writeln('Enter a non-negative number.');
        return;
    }
    if (qty === 0) {
        showShipyardsClass0Menu(ctx);
        return;
    }
    switch (kind) {
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
