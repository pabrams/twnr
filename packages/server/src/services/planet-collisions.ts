import { withTransaction } from '../db/index.js';
import type { Queryable } from '../db/types.js';
import {
    listDueCollisionsForUpdate,
    deletePlanet,
    type DueCollisionRow,
} from '../db/queries/planet.js';
import { getClanMembers } from '../db/queries/clan.js';
import { insertSystemMemo } from '../db/queries/message.js';
import { listPlayersOnPlanet } from '../db/queries/player.js';
import { recordGameEvent } from './game-events.js';
import { notifyPlanetDestroyed, type PlanetDestructionNotice } from './planet-destruction.js';

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

function destructionNotice(
    collision: DueCollisionRow,
    planetName: string,
    otherName: string,
    occupantIds: number[],
): PlanetDestructionNotice {
    return {
        universeId: collision.universe_id,
        sectorNumber: collision.sector_number,
        planetName,
        cause: 'collision',
        occupantIds,
        occupantMailBody:
            `Planet ${planetName} in sector ${collision.sector_number} was destroyed in a collision ` +
            `with ${otherName} while you were on the surface. You escaped to your ship.`,
        sender: { kind: 'system', label: SENDER_LABEL },
        excludePlayerId: null,
    };
}

/** Deletes both planets; returns the notices to send once the transaction commits. */
async function resolveCollision(
    collision: DueCollisionRow,
    client: Queryable,
): Promise<PlanetDestructionNotice[]> {
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

    const occupantIds = async (planetId: number) =>
        (await listPlayersOnPlanet(planetId, client)).map((occupant) => occupant.id);
    const notices = [
        destructionNotice(
            collision,
            collision.planet_name,
            collision.colliding_with_name,
            await occupantIds(collision.planet_id),
        ),
        destructionNotice(
            collision,
            collision.colliding_with_name,
            collision.planet_name,
            await occupantIds(collision.colliding_with_id),
        ),
    ];

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
    return notices;
}

export async function resolveDuePlanetCollisions(): Promise<number> {
    const notices = await withTransaction(async (client) => {
        const due = await listDueCollisionsForUpdate(client);
        const destroyed = new Set<number>();
        const pending: PlanetDestructionNotice[] = [];
        for (const collision of due) {
            // A planet already lost to an earlier collision this run can't collide again.
            if (destroyed.has(collision.planet_id) || destroyed.has(collision.colliding_with_id)) {
                continue;
            }
            pending.push(...(await resolveCollision(collision, client)));
            destroyed.add(collision.planet_id);
            destroyed.add(collision.colliding_with_id);
        }
        return pending;
    });
    if (!notices) return 0;
    for (const notice of notices) {
        await notifyPlanetDestroyed(notice);
    }
    return notices.length / 2;
}
