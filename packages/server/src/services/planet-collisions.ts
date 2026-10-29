import { withTransaction } from '../db/index.js';
import type { Queryable } from '../db/types.js';
import {
    listDueCollisionsForUpdate,
    deletePlanet,
    type DueCollisionRow,
} from '../db/queries/planet.js';
import { getClanMembers } from '../db/queries/clan.js';
import { insertSystemMemo } from '../db/queries/message.js';
import { recordGameEvent } from './game-events.js';

const SENDER_LABEL = 'Galactic Planet Registry';
const KIND_COLLISION = 'planet_collision';

async function ownerRecipients(
    ownerPlayerId: number | null,
    ownerClanId: number | null,
    client: Queryable,
): Promise<number[]> {
    if (ownerPlayerId !== null) return [ownerPlayerId];
    if (ownerClanId !== null) {
        const members = await getClanMembers(ownerClanId, client);
        return members.map((m) => m.id);
    }
    return [];
}

async function resolveCollision(collision: DueCollisionRow, client: Queryable): Promise<void> {
    const recipients = new Set([
        ...(await ownerRecipients(
            collision.planet_owner_player_id,
            collision.planet_owner_clan_id,
            client,
        )),
        ...(await ownerRecipients(
            collision.colliding_with_owner_player_id,
            collision.colliding_with_owner_clan_id,
            client,
        )),
    ]);
    const body =
        `${collision.planet_name} collided with ${collision.colliding_with_name} ` +
        `in sector ${collision.sector_number}. Both planets were destroyed.`;
    for (const recipientId of recipients) {
        await insertSystemMemo(recipientId, SENDER_LABEL, KIND_COLLISION, body, client);
    }

    // Deleting the planets cascades to the planet_collisions row and lifts anyone off them.
    await deletePlanet(collision.planet_id, client);
    await deletePlanet(collision.colliding_with_id, client);

    await recordGameEvent(
        collision.universe_id,
        {
            kind: 'planet_collision',
            planet: { planetId: collision.planet_id, name: collision.planet_name },
            collidingWith: {
                planetId: collision.colliding_with_id,
                name: collision.colliding_with_name,
            },
            sectorNumber: collision.sector_number,
        },
        client,
    );
}

export async function resolveDuePlanetCollisions(): Promise<number> {
    const resolved = await withTransaction(async (client) => {
        const due = await listDueCollisionsForUpdate(client);
        const destroyed = new Set<number>();
        let count = 0;
        for (const collision of due) {
            // A planet already lost to an earlier collision this run can't collide again.
            if (destroyed.has(collision.planet_id) || destroyed.has(collision.colliding_with_id)) {
                continue;
            }
            await resolveCollision(collision, client);
            destroyed.add(collision.planet_id);
            destroyed.add(collision.colliding_with_id);
            count++;
        }
        return count;
    });
    return resolved ?? 0;
}
