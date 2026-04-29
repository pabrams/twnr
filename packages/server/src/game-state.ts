/**
 * Backwards-compatibility facade. The contents of this module were split
 * into focused files under `state/`, `domain/`, and `services/`; this file
 * stays as a re-export hub so existing imports keep working while handlers
 * are migrated to the new paths one at a time. Eventually delete this file
 * once nothing imports from `game-state.js`.
 */

export type { Player, TradeState, TradeStep } from './state/players.js';
export { players, getPlayerUniverseId, setPlayerMenu } from './state/players.js';

export { broadcastTo, broadcastEnvelope, sendEnvelope, sendError } from './state/messaging.js';

export { getGraph, invalidateGraphCache } from './state/graph-cache.js';

export type { PortAction, PortClassActions } from './domain/port-classes.js';
export { PORT_CLASS_ACTIONS, portName } from './domain/port-classes.js';

export { getPlayerShip } from './services/ship-lookup.js';

export {
    getVisitedSectors,
    getWarpRefs,
    getPortForSector,
    getSectorDrones,
    getEmptyShipsInSector,
    resolveSectorId,
} from './services/sector-lookup.js';

export { buildSectorDisplayData } from './services/sector-display.js';
