import type { WebSocket } from 'ws';
import { Events } from '@twnr/shared';
import type { TowedAlong } from '@twnr/shared';
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

/** Notify the actor's sector of dock/undock/land/liftoff. Errors are logged, never thrown. */
export async function broadcastSectorActivity(
    playerId: number,
    activity: 'land' | 'liftoff' | 'dock' | 'undock',
    targetName: string | null = null,
): Promise<void> {
    try {
        const player = onlinePlayers[playerId];
        if (!player) return;
        const clients = await sectorObserverClients(player.universeId, player.sector, playerId);
        if (clients.size === 0) return;
        broadcastTo(
            {
                type: Events.SectorActivity.name,
                playerId,
                playerName: player.name,
                activity,
                targetName,
                shipName: player.shipName,
            },
            clients,
        );
    } catch (err) {
        console.error('broadcastSectorActivity error:', err);
    }
}

/** Notify both sectors of a ship move; call after player.sector is set to the target. Errors are logged, never thrown. */
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
