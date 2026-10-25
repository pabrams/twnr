import type { WebSocket } from 'ws';
import { ServerTag } from '@twnr/shared';
import type { TowedAlong } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { broadcastTo } from '../state/messaging.js';

/**
 * Collect the sockets of online players in a given sector who can "see"
 * activity happening there (excluding the acting player). Players who are
 * docked (port or starbase) or on a planet do not observe sector activity.
 */
export function sectorObserverClients(
    universeId: number,
    sector: number,
    excludePlayerId: number,
): Set<WebSocket> {
    const clients = new Set<WebSocket>();
    for (const [idStr, p] of Object.entries(onlinePlayers)) {
        if (Number(idStr) === excludePlayerId) continue;
        if (p.universeId !== universeId) continue;
        if (p.docked || p.at_starbase) continue;
        if (p.onPlanetId !== null) continue;
        if (p.sector === sector) clients.add(p.ws);
    }
    return clients;
}

/**
 * Notify online players in the actor's sector of local activity:
 * landing on / lifting off a planet, docking at / undocking from a port.
 */
export function broadcastSectorActivity(
    playerId: number,
    activity: 'land' | 'liftoff' | 'dock' | 'undock',
    targetName: string | null = null,
): void {
    try {
        const player = onlinePlayers[playerId];
        if (!player) return;
        const clients = sectorObserverClients(player.universeId, player.sector, playerId);
        if (clients.size === 0) return;
        broadcastTo(
            {
                type: ServerTag.SectorActivity,
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

/**
 * Notify online players in both the departure and arrival sectors that a
 * player moved between sectors. Call after the mover's in-memory sector has
 * been updated to the target sector.
 */
export function broadcastPlayerMoved(
    playerId: number,
    fromSector: number,
    toSector: number,
    towedAlong?: TowedAlong,
): void {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const oldSectorClients = sectorObserverClients(player.universeId, fromSector, playerId);
    const newSectorClients = sectorObserverClients(player.universeId, toSector, playerId);
    broadcastTo(
        {
            type: ServerTag.PlayerMoved,
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
            type: ServerTag.PlayerMoved,
            playerId,
            playerName: player.name,
            sector: toSector,
            direction: 'in',
            towedAlong,
        },
        newSectorClients,
    );
}
