import { Menu, Commands, command } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { echoCommand } from '../display.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { showHardwareItemDetail, showHardwareMenu } from '../display-starbase.js';
import { registerRoutine, registerMenuRoutine } from './types.js';
import { askChar, askNumber } from './prompts.js';

const STACKABLE: Record<string, { itemName: string; label: string }> = {
    buyTerraformDevice: { itemName: 'terraform_device', label: 'Terraform Devices' },
    buyPlanetBuster: { itemName: 'planet_buster', label: 'Planet Busters' },
    buyBuoy: { itemName: 'buoy', label: 'Marker Beacons' },
    buyMineDisruptor: { itemName: 'mine_disruptor', label: 'Mine Disruptors' },
    buyCloakingDevice: { itemName: 'cloaking_device', label: 'Cloaking Devices' },
    buyCorbomite: { itemName: 'corbomite', label: 'Corbomite' },
    buyPhotonTorpedo: { itemName: 'photon_torpedo', label: 'Photon Torpedoes' },
    buyReconDrone: { itemName: 'recon_drone', label: 'Recon Drones' },
};

const TOGGLE: Record<string, string> = {
    buyHyperspace1: 'hyperspace_1',
    buyHyperspace2: 'hyperspace_2',
    buyVisualScanner: 'visual_scanner',
    buyPlanetScanner: 'planet_scanner',
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
    ctx.io.sendMsg(command(Commands.BuyHardware, { itemName, quantity: qty }));
}

function buyToggle(ctx: GameContext, itemName: string): void {
    echoCommand(ctx, 'buyHardware');
    showHardwareItemDetail(ctx, itemName);
    ctx.io.sendMsg(command(Commands.BuyHardware, { itemName }));
}

for (const [routineName, spec] of Object.entries(STACKABLE)) {
    registerRoutine(routineName, (ctx) => buyStackable(ctx, spec.itemName, spec.label));
}

for (const [routineName, itemName] of Object.entries(TOGGLE)) {
    registerRoutine(routineName, (ctx) => buyToggle(ctx, itemName));
}

registerRoutine('buyMinesMenu', async (ctx) => {
    const choice = await askChar(ctx, render(EVENT.buyMineTypePrompt), ['p', 'l']);
    if (choice === null) return;
    const itemName = choice === 'p' ? 'proximity_mine' : 'seeker_mine';
    const label = choice === 'p' ? 'Proximity Mines' : 'Limpet Mines';
    await buyStackable(ctx, itemName, label);
});

registerMenuRoutine(Menu.StarbaseHardware, 'helpMenu', (ctx) => {
    showHardwareMenu(ctx);
});
