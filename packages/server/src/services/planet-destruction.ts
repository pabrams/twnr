import { type EventPayload, Events } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope, broadcastTo } from '../state/messaging.js';
import { insertMemo, insertSystemMemo } from '../db/queries/message.js';
import { sectorObserverClients } from './sector-activity.js';
import type { NotifySender } from './notify.js';

const MAIL_KIND = 'planet_destroyed';

export type PlanetDestructionNotice = {
    universeId: number;
    sectorNumber: number;
    planetName: string;
    cause: EventPayload<'PlanetDestroyed'>['cause'];
    /** Players who were on the surface and have been lifted back to their ships. */
    occupantIds: number[];
    occupantMailBody: string;
    sender: NotifySender;
    /** The destroyer, who already gets a result of their own. */
    excludePlayerId: number | null;
};

/** Call after the deleting transaction commits. */
export async function notifyPlanetDestroyed(notice: PlanetDestructionNotice): Promise<void> {
    const alert = {
        type: Events.PlanetDestroyed.name,
        planetName: notice.planetName,
        sector: notice.sectorNumber,
        cause: notice.cause,
    } as const;

    const occupants = notice.occupantIds.filter((id) => id !== notice.excludePlayerId);
    for (const occupantId of occupants) {
        if (notice.sender.kind === 'player') {
            await insertMemo(
                occupantId,
                notice.sender.playerId,
                null,
                MAIL_KIND,
                notice.occupantMailBody,
            );
        } else {
            await insertSystemMemo(
                occupantId,
                notice.sender.label,
                MAIL_KIND,
                notice.occupantMailBody,
            );
        }
        if (onlinePlayers[occupantId]) {
            sendEnvelope(occupantId, { ...alert, wasOnPlanet: true });
        }
    }

    const bystanders = await sectorObserverClients(
        notice.universeId,
        notice.sectorNumber,
        notice.excludePlayerId ?? -1,
    );
    for (const occupantId of occupants) {
        const ws = onlinePlayers[occupantId]?.ws;
        if (ws) bystanders.delete(ws);
    }
    broadcastTo({ ...alert, wasOnPlanet: false }, bystanders);
}
