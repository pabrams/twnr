import { type AcceptedReply, Commands, command } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { COMBAT, SECTOR } from '../messages/index.js';
import { echoCommand } from '../display.js';
import { renderAttributeChange } from '../handlers/utils.js';
import { registerRoutine } from './types.js';
import { askConfirm, askNumber } from './prompts.js';
import { request } from './io.js';

type AttackTarget = AcceptedReply<'AttackTargets'>['players'][number];

function shipLabel(target: AttackTarget): string {
    return target.shipTypeDisplayName ?? target.shipTypeName;
}

async function offerBeaconAttack(ctx: GameContext): Promise<void> {
    const destroyBeacon = await askConfirm(ctx, render(SECTOR.attackBeaconPrompt), {
        defaultValue: false,
    });
    if (!destroyBeacon) return;
    const reply = await request(ctx, Commands.AttackBeacon, {});
    if (reply?.destroyed) ctx.io.term.writeln(render(SECTOR.attackBeaconDestroyed));
}

function renderAttackResult(
    ctx: GameContext,
    target: AttackTarget,
    result: AcceptedReply<'AttackShip'>,
): void {
    ctx.io.term.writeln(
        render(COMBAT.attackDronesLost, {
            lost: result.attackerDronesLost,
            remaining: result.attackerDronesRemaining,
        }),
    );
    ctx.io.term.writeln(
        render(COMBAT.attackDronesDestroyed, {
            destroyed: result.defenderDronesLost,
            remaining: result.defenderDronesRemaining,
        }),
    );
    if (result.destroyed) {
        ctx.io.term.writeln(
            render(COMBAT.attackShipDestroyed, { name: target.name, ship: shipLabel(target) }),
        );
    }
    renderAttributeChange(ctx, result.expDelta ?? 0, result.repDelta ?? 0, 'combat');
}

async function attackPlayer(ctx: GameContext, target: AttackTarget): Promise<void> {
    const poweredUp = await request(ctx, Commands.PowerUpWeapons, { targetPlayerId: target.id });
    if (!poweredUp) return;
    const { maxWaveDrones } = poweredUp;
    const drones = await askNumber(ctx, render(COMBAT.attackQtyPrompt, { max: maxWaveDrones }), {
        min: 0,
        max: maxWaveDrones,
        defaultValue: 0,
    });
    if (!drones) return;
    const result = await request(ctx, Commands.AttackShip, { targetPlayerId: target.id, drones });
    if (!result) return;
    renderAttackResult(ctx, target, result);
    ctx.io.sendMsg(command(Commands.SectorDisplay, {}));
}

registerRoutine('attackMenu', async (ctx) => {
    echoCommand(ctx, 'attack');
    const targets = await request(ctx, Commands.AttackTargets, {});
    if (!targets) return;
    if (targets.beaconPresent) await offerBeaconAttack(ctx);
    if (targets.players.length === 0) {
        ctx.io.term.writeln(render(COMBAT.attackNoTargets));
        return;
    }
    for (const target of targets.players) {
        const confirmed = await askConfirm(
            ctx,
            render(COMBAT.attackTargetPrompt, {
                name: target.name,
                ship: shipLabel(target),
                drones: targets.shipDrones,
                targetDrones: target.drones,
            }),
            { defaultValue: false },
        );
        if (confirmed === null) return;
        if (confirmed) {
            await attackPlayer(ctx, target);
            return;
        }
    }
});
