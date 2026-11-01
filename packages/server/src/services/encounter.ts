import { onlinePlayers } from '../state/players.js';

// A drone encounter is session state, not a property of the sector: it starts
// when a warp lands the player in front of hostile drones (the client opens the
// encounter menu on that reply) and ends when they win or retreat. Drones
// deployed around a player who is already in the sector do not trap them.

export function isInEncounter(playerId: number): boolean {
    return onlinePlayers[playerId]?.inEncounter === true;
}

export function enterEncounter(playerId: number): void {
    const player = onlinePlayers[playerId];
    if (player) player.inEncounter = true;
}

export function leaveEncounter(playerId: number): void {
    const player = onlinePlayers[playerId];
    if (player) player.inEncounter = false;
}
