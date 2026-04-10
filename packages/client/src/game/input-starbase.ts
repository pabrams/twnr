import { ClientMsgType } from '@twnr/shared';
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
} from './display-starbase.js';
import { colors } from './constants.js';

export function handleStarbaseInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'h':
            ctx.changeMenu('starbaseHardware');
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

// Map hardware menu keys to ClientMsgType and labels
const STACKABLE_HARDWARE: Record<string, { msgType: string; label: string }> = {
    t: { msgType: ClientMsgType.BuyTerraformDevices, label: 'Terraform Devices' },
    b: { msgType: ClientMsgType.BuyPlanetBusters, label: 'Planet Busters' },
    u: { msgType: ClientMsgType.BuyBuoys, label: 'Space Buoys' },
    p: { msgType: ClientMsgType.BuyProximityMines, label: 'Proximity Mines' },
    s: { msgType: ClientMsgType.BuySeekerMines, label: 'Seeker Mines' },
    o: { msgType: ClientMsgType.BuyOrbitalMines, label: 'Orbital Mines' },
    d: { msgType: ClientMsgType.BuyMineDisruptors, label: 'Mine Disruptors' },
    k: { msgType: ClientMsgType.BuyCloakingDevice, label: 'Cloaking Devices' },
    c: { msgType: ClientMsgType.BuyCorbomite, label: 'Corbomite' },
    h: { msgType: ClientMsgType.BuyPhotonTorpedoes, label: 'Photon Torpedoes' },
    r: { msgType: ClientMsgType.BuyReconDrones, label: 'Recon Drones' },
};

export function handleHardwareInput(ctx: GameContext, line: string) {
    const key = line.toLowerCase();
    // Toggle hardware (no quantity needed)
    if (key === '1') {
        ctx.sendMsg({ type: ClientMsgType.BuyHyperspaceDrive, driveType: 1 });
        return;
    }
    if (key === '2') {
        ctx.sendMsg({ type: ClientMsgType.BuyHyperspaceDrive, driveType: 2 });
        return;
    }
    if (key === 'v') {
        ctx.sendMsg({ type: ClientMsgType.BuyVisualScanner });
        return;
    }
    if (key === 'n') {
        ctx.sendMsg({ type: ClientMsgType.BuyPlanetScanner });
        return;
    }
    // Stackable hardware (needs quantity)
    const hw = STACKABLE_HARDWARE[key];
    if (hw) {
        (ctx as any).starbaseBuyType = hw.msgType;
        ctx.changeMenu('starbaseBuyQty');
        showBuyQtyPrompt(ctx, hw.label);
        return;
    }
    if (key === '?') {
        showHardwareHelp(ctx);
        return;
    }
    if (key === 'q') {
        ctx.changeMenu('starbase');
        showStarbaseMenu(ctx);
        return;
    }
    showHardwarePrompt(ctx);
}

export function handleStarbaseBuyQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('starbaseHardware');
        showHardwareMenu(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    const msgType = (ctx as any).starbaseBuyType;
    if (msgType) {
        ctx.sendMsg({ type: msgType, quantity: qty } as any);
    }
}

export function handlePlanetSelectInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('sector');
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    const planets = (ctx as any).landablePlanets;
    if (planets && idx >= 0 && idx < planets.length) {
        ctx.sendMsg({ type: ClientMsgType.LandOnPlanet, planetId: planets[idx].id });
    } else {
        ctx.term.writeln(colors.boldRed('Invalid selection.'));
    }
}

export function handleHyperspaceJumpInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu('computer');
        return;
    }
    const sector = parseInt(line, 10);
    if (isNaN(sector) || sector <= 0) {
        ctx.term.writeln('Enter a valid sector number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.HyperspaceJump, targetSector: sector });
}
