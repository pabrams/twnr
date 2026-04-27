import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from './types.js';
import { echoCommand, showPrompt } from './display.js';
import { showAttackDronesPrompt, showDroneAttackQtyPrompt } from './display-combat.js';
import { render } from './renderer.js';
import { NOTIFY, COMMON } from './messages/index.js';

export function handleAttackInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
        showPrompt(ctx);
        return;
    }
    const idx = parseInt(line, 10) - 1;
    if (idx >= 0 && idx < ctx.sectorPlayers.length) {
        ctx.attackTarget = ctx.sectorPlayers[idx].id;
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.AttackDrones });
        showAttackDronesPrompt(ctx);
    } else {
        ctx.term.writeln(render(NOTIFY.invalidSelection));
    }
}

export function handleAttackDronesInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
        showPrompt(ctx);
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    // qty submission for an in-progress Attack flow — the <Attack> echo
    // already fired when the player pressed A at the sector menu.
    ctx.sendMsg({
        type: ClientMsgType.AttackShip,
        targetPlayerId: ctx.attackTarget!,
        drones: qty,
    });
}

export function handleDeployDronesQtyInput(ctx: GameContext, line: string) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
        showPrompt(ctx);
        return;
    }
    // Empty Enter → accept default (server computes it). The <Deploy Drones>
    // echo fired at D-press in input.ts; this is the qty submission step.
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
            // Multi-step: qty prompt next; the AttackSectorDrones ClientMsg
            // is the qty submission, no echo at that step.
            echoCommand(ctx, 'attackSectorDrones');
            ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DroneAttackQty });
            showDroneAttackQtyPrompt(ctx);
            break;
        case 'r':
            echoCommand(ctx, 'retreatFromDrones');
            ctx.sendMsg({ type: ClientMsgType.RetreatFromDrones });
            break;
        default:
            ctx.term.writeln(render(COMMON.menuRow, { key: 'A', text: 'Attack' }));
            ctx.term.writeln(render(COMMON.menuRow, { key: 'R', text: 'Retreat' }));
    }
}

export function handleDroneAttackQtyInput(ctx: GameContext, line: string) {
    if (line.toLowerCase() === 'q') {
        ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DroneEncounter });
        return;
    }
    const qty = parseInt(line, 10);
    if (isNaN(qty) || qty <= 0) {
        ctx.term.writeln('Enter a positive number.');
        return;
    }
    // qty submission — the echo fired at A-press in handleDroneEncounterInput.
    ctx.sendMsg({ type: ClientMsgType.AttackSectorDrones, drones: qty });
}
