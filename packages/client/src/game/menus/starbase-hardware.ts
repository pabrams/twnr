import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand } from '../display.js';
import { showHardwareMenu, showHardwareItemDetail } from '../display-starbase.js';
import { registerMenu } from './types.js';

// Map hardware menu keys to item names and labels for quantity-based purchases.
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

registerMenu(Menu.StarbaseHardware, {
    enter: showHardwareMenu,
    input(ctx, line) {
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
        // default max. Echo at the keystroke (multi-step flow continues with
        // a qty prompt; the BuyHardware sendMsg later doesn't echo again).
        const hw = STACKABLE_HARDWARE[key];
        if (hw) {
            echoCommand(ctx, 'buyHardware');
            const canBuy = showHardwareItemDetail(ctx, hw.itemName);
            if (canBuy <= 0) {
                // Nothing to buy (no capacity or no credits) — stay in the menu.
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
    },
});
