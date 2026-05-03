import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { echoCommand } from '../display.js';
import {
    showHardwareMenu,
    showHardwarePrompt,
    showHardwareItemDetail,
} from '../display-starbase.js';
import { registerMenu } from './types.js';
import { askChar, askNumber } from './prompts.js';

/**
 * Hardware Store — client-driven menu. The server sends the catalog
 * (hardwarePrices, current credits, ship's per-item state) when the
 * player enters via Starbase H, then doesn't dictate any keys. The
 * client picks the layout, key bindings, and any sub-prompts (mines
 * type → quantity) entirely from cached data.
 *
 * No `menu_command` rows for `starbaseHardware` in the DB. The dispatcher's
 * permissive fallback (input.ts:isValidKeyForMenu — empty commands → accept
 * any key) lets us own all dispatch here. Send a `BuyHardware{itemName,
 * quantity?}` per purchase; the server validates and returns updated state
 * via `HardwareStoreInfoResult`.
 */

// Stackable items the player buys some N of. T=Terraform Devices, etc.
// Mines (proximity, seeker) are NOT here — they sit behind the M sub-prompt.
const STACKABLE: Record<string, { itemName: string; label: string }> = {
    t: { itemName: 'terraform_device', label: 'Terraform Devices' },
    b: { itemName: 'planet_buster', label: 'Planet Busters' },
    u: { itemName: 'buoy', label: 'Space Buoys' },
    d: { itemName: 'mine_disruptor', label: 'Mine Disruptors' },
    k: { itemName: 'cloaking_device', label: 'Cloaking Devices' },
    c: { itemName: 'corbomite', label: 'Corbomite' },
    h: { itemName: 'photon_torpedo', label: 'Photon Torpedoes' },
    r: { itemName: 'recon_drone', label: 'Recon Drones' },
};

// Toggle items: install one, no quantity. 1/2 = hyperspace tiers, V/N = scanners.
const TOGGLE: Record<string, string> = {
    '1': 'hyperspace_1',
    '2': 'hyperspace_2',
    v: 'visual_scanner',
    n: 'planet_scanner',
};

async function buyStackable(ctx: GameContext, itemName: string, label: string): Promise<void> {
    echoCommand(ctx, 'buyHardware');
    const canBuy = showHardwareItemDetail(ctx, itemName);
    if (canBuy <= 0) return; // capacity / credits already reported by detail
    const qty = await askNumber(ctx, `How many ${label}? [${canBuy}] `, {
        min: 1,
        max: canBuy,
        defaultValue: canBuy,
    });
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.BuyHardware, itemName, quantity: qty });
}

const HW_VALID_KEYS = new Set<string>([
    ...Object.keys(STACKABLE),
    ...Object.keys(TOGGLE),
    'm',
    '?',
    'q',
]);

registerMenu(Menu.StarbaseHardware, {
    renderPrompt: showHardwarePrompt,
    acceptsKey: (key) => HW_VALID_KEYS.has(key.toLowerCase()),
    input(ctx, line) {
        if (line === '') return;
        const key = line.toLowerCase();

        const toggle = TOGGLE[key];
        if (toggle) {
            echoCommand(ctx, 'buyHardware');
            showHardwareItemDetail(ctx, toggle);
            ctx.io.sendMsg({ type: ClientMsgType.BuyHardware, itemName: toggle });
            return;
        }

        const hw = STACKABLE[key];
        if (hw) {
            void buyStackable(ctx, hw.itemName, hw.label);
            return;
        }

        // Mines submenu — askChar then askNumber inline. No starbaseMines menu.
        if (key === 'm') {
            void buyMines(ctx);
            return;
        }

        if (key === '?') {
            showHardwareMenu(ctx);
            return;
        }
        if (key === 'q') {
            echoCommand(ctx, 'starbase');
            ctx.io.sendMsg({ type: ClientMsgType.Back });
            return;
        }
    },
});

async function buyMines(ctx: GameContext): Promise<void> {
    const choice = await askChar(ctx, 'Mines: (P)roximity or (S)eeker? ', ['p', 's']);
    if (choice === null) return;
    const itemName = choice === 'p' ? 'proximity_mine' : 'seeker_mine';
    const label = choice === 'p' ? 'Proximity Mines' : 'Seeker Mines';
    await buyStackable(ctx, itemName, label);
}
