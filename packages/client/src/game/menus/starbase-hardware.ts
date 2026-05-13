import { ClientTag, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { echoCommand } from '../display.js';
import {
    showHardwareMenu,
    showHardwarePrompt,
    showHardwareItemDetail,
} from '../display-starbase.js';
import { registerMenu } from './types.js';
import { askChar, askNumber } from './prompts.js';

const STACKABLE: Record<string, { itemName: string; label: string }> = {
    t: { itemName: 'terraform_device', label: 'Terraform Devices' },
    b: { itemName: 'planet_buster', label: 'Planet Busters' },
    u: { itemName: 'buoy', label: 'Marker Beacons' },
    d: { itemName: 'mine_disruptor', label: 'Mine Disruptors' },
    k: { itemName: 'cloaking_device', label: 'Cloaking Devices' },
    c: { itemName: 'corbomite', label: 'Corbomite' },
    h: { itemName: 'photon_torpedo', label: 'Photon Torpedoes' },
    r: { itemName: 'recon_drone', label: 'Recon Drones' },
};

const TOGGLE: Record<string, string> = {
    '1': 'hyperspace_1',
    '2': 'hyperspace_2',
    v: 'visual_scanner',
    n: 'planet_scanner',
};

async function buyStackable(ctx: GameContext, itemName: string, label: string): Promise<void> {
    echoCommand(ctx, 'buyHardware');
    const canBuy = showHardwareItemDetail(ctx, itemName);
    if (canBuy <= 0) return;
    const qty = await askNumber(ctx, `How many ${label}? [${canBuy}] `, {
        min: 1,
        max: canBuy,
        defaultValue: canBuy,
    });
    if (qty === null) return;
    ctx.io.sendMsg({ type: ClientTag.BuyHardware, itemName, quantity: qty });
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
            ctx.io.sendMsg({ type: ClientTag.BuyHardware, itemName: toggle });
            return;
        }

        const hw = STACKABLE[key];
        if (hw) {
            void buyStackable(ctx, hw.itemName, hw.label);
            return;
        }
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
            ctx.world.mode = Menu.Starbase;
            return;
        }
    },
});

async function buyMines(ctx: GameContext): Promise<void> {
    const choice = await askChar(ctx, 'Mines: (P)roximity or (L)impet? ', ['p', 'l']);
    if (choice === null) return;
    const itemName = choice === 'p' ? 'proximity_mine' : 'seeker_mine';
    const label = choice === 'p' ? 'Proximity Mines' : 'Limpet Mines';
    await buyStackable(ctx, itemName, label);
}
