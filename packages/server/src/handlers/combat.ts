import { WebSocket } from 'ws';
import { ServerMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';
import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';

export async function handleAttackShip(
    ws: WebSocket,
    attackerId: number,
    targetPlayerId: number,
    fighters: number,
): Promise<void> {
    if (!Number.isInteger(fighters) || fighters <= 0) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'Invalid number of fighters',
        });
        return;
    }

    if (attackerId === targetPlayerId) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'You cannot attack yourself',
        });
        return;
    }

    const attacker = players[attackerId];
    const target = players[targetPlayerId];

    if (
        !attacker ||
        !target ||
        attacker.sector !== target.sector ||
        attacker.universeId !== target.universeId
    ) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'Target is not in this sector',
        });
        return;
    }

    if (target.docked) {
        sendEnvelope(attackerId, {
            type: ServerMsgType.Error,
            message: 'Target is docked at a port',
        });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const attackerShipRes = await client.query(
            'SELECT fighters FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [attackerId],
        );
        const targetShipRes = await client.query(
            'SELECT fighters, shields FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [targetPlayerId],
        );

        if (attackerShipRes.rows.length === 0 || targetShipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const attackerFighters = attackerShipRes.rows[0].fighters;
        let targetShields = targetShipRes.rows[0].shields;
        let targetFighters = targetShipRes.rows[0].fighters;

        if (fighters > attackerFighters) {
            await client.query('ROLLBACK');
            sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Not enough fighters' });
            return;
        }

        let remainingAttack = fighters;
        let shieldsLost = 0;
        let defenderFightersLost = 0;

        const shieldAbsorb = Math.min(targetShields, remainingAttack);
        shieldsLost = shieldAbsorb;
        targetShields -= shieldAbsorb;
        remainingAttack -= shieldAbsorb;

        if (remainingAttack > 0) {
            const fighterAbsorb = Math.min(targetFighters, remainingAttack);
            defenderFightersLost = fighterAbsorb;
            targetFighters -= fighterAbsorb;
            remainingAttack -= fighterAbsorb;
        }

        const destroyed = remainingAttack > 0;
        const attackerFightersLost = shieldsLost + defenderFightersLost;
        const newAttackerFighters = attackerFighters - attackerFightersLost;

        await client.query('UPDATE player_ships SET fighters = $1 WHERE player_id = $2', [
            newAttackerFighters,
            attackerId,
        ]);

        if (destroyed) {
            await client.query('UPDATE players SET ship_destroyed_date = NOW() WHERE id = $1', [
                targetPlayerId,
            ]);
            await client.query('DELETE FROM player_ships WHERE player_id = $1', [targetPlayerId]);
            await client.query('DELETE FROM ship_cargo WHERE player_id = $1', [targetPlayerId]);
        } else {
            await client.query(
                'UPDATE player_ships SET fighters = $1, shields = $2 WHERE player_id = $3',
                [targetFighters, targetShields, targetPlayerId],
            );
        }

        await client.query('COMMIT');

        await setPlayerMenu(attackerId, 'sector');
        const resultMsg: ServerResult = {
            type: ServerMsgType.AttackShipResult,
            destroyed,
            attackerFightersLost,
            defenderFightersLost,
            defenderShieldsLost: shieldsLost,
            message: destroyed ? 'Target destroyed!' : 'Attack completed.',
        };
        sendEnvelope(attackerId, resultMsg);

        if (target.ws && target.ws.readyState === 1) {
            sendEnvelope(targetPlayerId, {
                type: ServerMsgType.AttackShipResult,
                destroyed,
                attackerFightersLost,
                defenderFightersLost,
                defenderShieldsLost: shieldsLost,
                message: destroyed ? 'Your ship was destroyed!' : 'You were attacked!',
            });
            if (destroyed) {
                target.ws.close(1008, 'Ship destroyed');
            }
        }
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Attack error', e);
        sendEnvelope(attackerId, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}
