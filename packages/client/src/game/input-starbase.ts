import { ClientMsgType, Menu, type ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { echoCommand } from './display.js';
import {
    showStarbaseHelp,
    showStarbasePrompt,
    showHardwareMenu,
    showHardwareItemDetail,
    showShipyardsHelp,
    showShipyardsPrompt,
    showShipExamineList,
    letterToIndex,
} from './display-starbase.js';
import { showShipDetail, showShipInterestPrompt } from './display-computer.js';
import { class0MaxBuy, showClass0Menu } from './display-port.js';
import { render } from './renderer.js';
import { NOTIFY, COMMON } from './messages/index.js';

export function handleStarbaseInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 's':
            echoCommand(ctx, 'shipyards');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
            break;
        case 'h':
            echoCommand(ctx, 'hardwareStoreInfo');
            ctx.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
            break;
        case '?':
            showStarbaseHelp(ctx);
            break;
        case 'q':
            echoCommand(ctx, 'leaveStarbase');
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
        echoCommand(ctx, 'buyHardware');
        showHardwareItemDetail(ctx, toggleItem);
        ctx.sendMsg({ type: ClientMsgType.BuyHardware, itemName: toggleItem });
        return;
    }

    // Stackable hardware: show detail, then transition to qty prompt with
    // default max. Echo at the keystroke (multi-step flow continues with a
    // qty prompt; the BuyHardware sendMsg below doesn't echo again).
    const hw = STACKABLE_HARDWARE[key];
    if (hw) {
        echoCommand(ctx, 'buyHardware');
        const canBuy = showHardwareItemDetail(ctx, hw.itemName);
        if (canBuy <= 0) {
            // Nothing to buy (no capacity or no credits) — stay in the hardware menu.
            showHardwareMenu(ctx);
            return;
        }
        ctx.starbaseBuyItemName = hw.itemName;
        ctx.starbaseBuyDefault = canBuy;
        ctx.starbaseBuyLabel = hw.label;
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.StarbaseBuyQty });
        return;
    }
    if (key === '?') {
        showHardwareMenu(ctx);
        return;
    }
    if (key === 'q') {
        echoCommand(ctx, 'starbase');
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Starbase });
        return;
    }
    showHardwareMenu(ctx);
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
            echoCommand(ctx, 'shipyardsBuy');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsBuy });
            break;
        case 'e':
            echoCommand(ctx, 'shipyardsExamine');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsExamine });
            break;
        case 'p':
            echoCommand(ctx, 'shipyardsEquipment');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
            break;
        case '?':
            showShipyardsHelp(ctx);
            break;
        case 'q':
            echoCommand(ctx, 'starbase');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Starbase });
            break;
        default:
            showShipyardsPrompt(ctx);
    }
}

export function handleShipyardsBuyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        echoCommand(ctx, 'shipyards');
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
        return;
    }
    const idx = letterToIndex(line);
    if (ctx.shipConfigs && idx >= 0 && idx < ctx.shipConfigs.length) {
        const ship = ctx.shipConfigs[idx];
        if (ship.name === ctx.currentShipName) {
            ctx.term.writeln(render(COMMON.errorLine, { text: 'Already flying that ship.' }));
            return;
        }
        ctx.shipyardsBuyTarget = ship.name;
        ctx.shipyardsBuyDisplayName = ship.display_name ?? ship.name;
        ctx.shipyardsBuyPrice = calculateShipPrice(ship);
        ctx.shipyardsBuyTradein = getCurrentShipPrice(ctx);
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsTradein });
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
    }
}

export function handleShipyardsTradeinInput(ctx: GameContext, line: string) {
    const targetShipName = ctx.shipyardsBuyTarget;
    if (!targetShipName) {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
        return;
    }
    switch (line.toLowerCase()) {
        case 'y':
            echoCommand(ctx, 'buyShipTradein');
            ctx.sendMsg({ type: ClientMsgType.BuyShipTradein, targetShipName });
            break;
        case 'n':
            echoCommand(ctx, 'buyShipNew');
            ctx.sendMsg({ type: ClientMsgType.BuyShipNew, targetShipName });
            break;
        case 'q':
            echoCommand(ctx, 'shipyardsBuy');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsBuy });
            break;
        default:
            ctx.term.write(render('[c]Trade in?[/c] (Y/N/Q) '));
    }
}

export function handleShipyardsExamineInput(ctx: GameContext, line: string) {
    const lower = line.toLowerCase();
    if (lower === 'q') {
        echoCommand(ctx, 'shipyards');
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
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
    const choose = (
        kind: 'drones' | 'shields' | 'holds',
        echoKey: 'buyHolds' | 'buyDrones' | 'buyShields',
    ) => {
        echoCommand(ctx, echoKey);
        ctx.class0BuyType = kind;
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0Qty });
    };
    switch (line.toLowerCase()) {
        case 'a':
            choose('holds', 'buyHolds');
            break;
        case 'b':
            choose('drones', 'buyDrones');
            break;
        case 'c':
            choose('shields', 'buyShields');
            break;
        case 'q':
            echoCommand(ctx, 'shipyards');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Shipyards });
            break;
        case '?':
        default:
            showClass0Menu(ctx);
    }
}
