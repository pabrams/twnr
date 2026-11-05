import type { WebSocket } from 'ws';
import { Events } from '@twnr/shared';
import type { ServerEnvelope, TowedAlong } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { broadcastTo } from '../state/messaging.js';
import { filterPlayersNotOnPlanet } from '../db/queries/player.js';

/** Sockets of players who can see activity in the sector: online, not the actor, not docked or on a planet. */
export async function sectorObserverClients(
    universeId: number,
    sector: number,
    excludePlayerId: number,
): Promise<Set<WebSocket>> {
    const candidates = new Map<number, WebSocket>();
    for (const [idStr, p] of Object.entries(onlinePlayers)) {
        const id = Number(idStr);
        if (id === excludePlayerId) continue;
        if (p.universeId !== universeId) continue;
        if (p.docked || p.at_starbase) continue;
        if (p.sector === sector) candidates.set(id, p.ws);
    }
    if (candidates.size === 0) return new Set();
    const offPlanetIds = await filterPlayersNotOnPlanet([...candidates.keys()]);
    const clients = new Set<WebSocket>();
    for (const id of offPlanetIds) {
        const ws = candidates.get(id);
        if (ws) clients.add(ws);
    }
    return clients;
}

/** Send any event to everyone observing the actor's sector. */
export async function broadcastToSectorObservers(
    actorId: number,
    event: ServerEnvelope,
    alsoExcludePlayerIds: number[] = [],
): Promise<void> {
    try {
        const actor = onlinePlayers[actorId];
        if (!actor) return;
        const clients = await sectorObserverClients(actor.universeId, actor.sector, actorId);
        for (const excludedId of alsoExcludePlayerIds) {
            const ws = onlinePlayers[excludedId]?.ws;
            if (ws) clients.delete(ws);
        }
        broadcastTo(event, clients);
    } catch (err) {
        console.error('broadcastToSectorObservers error:', err);
    }
}

/** broadcastToSectorObservers specialized for dock/undock/land/liftoff. */
export async function broadcastSectorActivity(
    playerId: number,
    activity: 'land' | 'liftoff' | 'dock' | 'undock',
    targetName: string | null = null,
): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    await broadcastToSectorObservers(playerId, {
        type: Events.SectorActivity.name,
        playerId,
        playerName: player.name,
        activity,
        targetName,
        shipName: player.shipName,
    });
}

/** Notify both sectors of a ship move; call after player.sector is set to the target. */
export async function broadcastPlayerMoved(
    playerId: number,
    fromSector: number,
    toSector: number,
    towedAlong?: TowedAlong,
): Promise<void> {
    try {
        const player = onlinePlayers[playerId];
        if (!player) return;
        const [oldSectorClients, newSectorClients] = await Promise.all([
            sectorObserverClients(player.universeId, fromSector, playerId),
            sectorObserverClients(player.universeId, toSector, playerId),
        ]);
        broadcastTo(
            {
                type: Events.PlayerMoved.name,
                playerId,
                playerName: player.name,
                sector: toSector,
                direction: 'out',
                towedAlong,
            },
            oldSectorClients,
        );
        broadcastTo(
            {
                type: Events.PlayerMoved.name,
                playerId,
                playerName: player.name,
                sector: toSector,
                direction: 'in',
                towedAlong,
            },
            newSectorClients,
        );
    } catch (err) {
        console.error('broadcastPlayerMoved error:', err);
    }
}
