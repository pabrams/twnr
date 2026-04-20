import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { showPrompt } from './display.js';
import { showAttackDronesPrompt, showDroneAttackQtyPrompt } from './display-combat.js';
import { render } from './renderer.js';
import { NOTIFY, COMMON } from './messages/index.js';

export function handleAttackInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Sector);
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    if (idx >= 0 && idx < ctx.sectorPlayers.length) {
        ctx.attackTarget = ctx.sectorPlayers[idx].id;
        ctx.changeMenu(Menu.AttackDrones);
        showAttackDronesPrompt(ctx);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
    }
}

export function handleAttackDronesInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Sector);
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({
        type: ClientMsgType.AttackShip,
        targetPlayerId: ctx.attackTarget!,
        drones: qty,
    });
}

export function handleDeployDronesQtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.Sector);
        showPrompt(ctx);
        return;
    }
    // Empty Enter → accept default (server computes it)
    if (trimmed === '') {
        ctx.sendMsg({ type: ClientMsgType.DeployDrones, quantity: -1 });
        return;
    }
    const qty = parseInt(trimmed, 10);
    if (isNaN(qty) || qty < 0) {
        ctx.term.writeln('Enter a non-negative number (0 to retrieve all).');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.DeployDrones, quantity: qty });
}

export function handleDroneEncounterInput(ctx: GameContext, line: string) {
    switch (line.toLowerCase()) {
        case 'a':
            ctx.changeMenu(Menu.DroneAttackQty);
            showDroneAttackQtyPrompt(ctx);
            break;
        case 'r':
            ctx.sendMsg({ type: ClientMsgType.RetreatFromDrones });
            break;
        default:
            ctx.term.writeln(render(COMMON.menuRow, { key: 'A', text: 'Attack' }));
            ctx.term.writeln(render(COMMON.menuRow, { key: 'R', text: 'Retreat' }));
    }
}

export function handleDroneAttackQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.changeMenu(Menu.DroneEncounter);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    ctx.sendMsg({ type: ClientMsgType.AttackSectorDrones, drones: qty });
}
