import { ClientTag, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { echoCommand } from '../display.js';
import { showHardwareItemDetail, showHardwareMenu } from '../display-starbase.js';
import { registerRoutine, registerMenuRoutine } from './types.js';
import { askChar, askNumber } from './prompts.js';

const STACKABLE: Record<string, { itemName: string; label: string }> = {
    buy_terraform_device: { itemName: 'terraform_device', label: 'Terraform Devices' },
    buy_planet_buster: { itemName: 'planet_buster', label: 'Planet Busters' },
    buy_buoy: { itemName: 'buoy', label: 'Marker Beacons' },
    buy_mine_disruptor: { itemName: 'mine_disruptor', label: 'Mine Disruptors' },
    buy_cloaking_device: { itemName: 'cloaking_device', label: 'Cloaking Devices' },
    buy_corbomite: { itemName: 'corbomite', label: 'Corbomite' },
    buy_photon_torpedo: { itemName: 'photon_torpedo', label: 'Photon Torpedoes' },
    buy_recon_drone: { itemName: 'recon_drone', label: 'Recon Drones' },
};

const TOGGLE: Record<string, string> = {
    buy_hyperspace_1: 'hyperspace_1',
    buy_hyperspace_2: 'hyperspace_2',
    buy_visual_scanner: 'visual_scanner',
    buy_planet_scanner: 'planet_scanner',
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

function buyToggle(ctx: GameContext, itemName: string): void {
    echoCommand(ctx, 'buyHardware');
    showHardwareItemDetail(ctx, itemName);
    ctx.io.sendMsg({ type: ClientTag.BuyHardware, itemName });
}

for (const [routineName, spec] of Object.entries(STACKABLE)) {
    registerRoutine(routineName, (ctx) => buyStackable(ctx, spec.itemName, spec.label));
}

for (const [routineName, itemName] of Object.entries(TOGGLE)) {
    registerRoutine(routineName, (ctx) => buyToggle(ctx, itemName));
}

registerRoutine('buy_mines_menu', async (ctx) => {
    const choice = await askChar(ctx, 'Mines: (P)roximity or (L)impet? ', ['p', 'l']);
    if (choice === null) return;
    const itemName = choice === 'p' ? 'proximity_mine' : 'seeker_mine';
    const label = choice === 'p' ? 'Proximity Mines' : 'Limpet Mines';
    await buyStackable(ctx, itemName, label);
});

// Hardware store's `?` is a fancier visual than the generic help_menu listing.
registerMenuRoutine(Menu.StarbaseHardware, 'help_menu', (ctx) => {
    showHardwareMenu(ctx);
});
