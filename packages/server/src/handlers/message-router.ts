import { ClientMsgType, ServerMsgType, type ClientCommand } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { getVisitedSectors } from '../services/sector-lookup.js';
import { countSectorsInUniverse } from '../db/queries/sector.js';
import {
    handleMove,
    handleMoveToPrevious,
    handleSectorDisplay,
    handleWarpsOut,
    handleShortestPath,
} from './movement.js';
import {
    handlePortInfo,
    handleDock,
    handleUndock,
    handlePortTransaction,
    handleDockStarbase,
    handleLeaveStarbase,
} from './port.js';
import {
    handleShipInfo,
    handleListOwnedShips,
    handleTransportToShip,
    handleChangeShipOwnership,
} from './ship-info.js';
import { handleStarbaseInfo } from './starbase-info.js';
import { handleBuyDrones, handleBuyShields, handleBuyHolds } from './ship-upgrades.js';
import { handleBuyShipTradein, handleBuyShipNew } from './ship-exchange.js';
import { handleJettison } from './ship-cargo.js';
import { handleGetAttackTargets, handleAttackShip } from './combat.js';
import {
    handleGetSectorPlanets,
    handleLandOnPlanet,
    handlePlanetDisplay,
    handleLeavePlanet,
    handleDestroyPlanet,
    handleUseTerraformDevice,
    handleTerraformInfo,
    handleTakeColonists,
    handleLeaveColonists,
    handleTakeCommodity,
    handleLeaveCommodity,
    handleListPlanets,
    handleClaimPlanet,
} from './planet.js';
import {
    handleDeployDronesInfo,
    handleDeployDrones,
    handleAttackSectorDrones,
    handleRetreatFromDrones,
} from './sector-drones.js';
import { handleListDeployedDrones, handleHyperspaceJump } from './hyperwarp.js';
import { handleBuyHardware, handleHardwareStoreInfo } from './hardware-store.js';
import { handleGetNeighborhood } from './neighborhood.js';
import {
    handleDeployMine,
    handleListDeployedMines,
    handleTrackSeekerMines,
    handleMineDisruptor,
} from './mines.js';
import {
    handleClanCreate,
    handleClanJoin,
    handleClanLeave,
    handleClanList,
    handleClanInfo,
    handleClanTransfer,
    handleClanMemo,
    handleClanSetPassword,
    handleClanDropMember,
} from './clan.js';

export async function handleMessage(playerId: number, data: ClientCommand): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(playerId, data.sector);
        case ClientMsgType.MoveToPrevious:
            return handleMoveToPrevious(playerId);
        case ClientMsgType.SectorDisplay:
            return handleSectorDisplay(playerId);
        case ClientMsgType.PlayersOnline:
            return handlePlayersOnline(playerId);
        case ClientMsgType.WarpsOut:
            return handleWarpsOut(playerId, data.id);
        case ClientMsgType.ShortestPath:
            return handleShortestPath(playerId, data.from, data.to);
        case ClientMsgType.PortInfo:
            return handlePortInfo(playerId, data.sectorId);
        case ClientMsgType.ShipInfo:
            return handleShipInfo(playerId);
        case ClientMsgType.PortTransaction:
            return handlePortTransaction(playerId, data.good, data.quantity, data.action);
        case ClientMsgType.BuyDrones:
            return handleBuyDrones(playerId, data.quantity);
        case ClientMsgType.BuyShields:
            return handleBuyShields(playerId, data.quantity);
        case ClientMsgType.BuyHolds:
            return handleBuyHolds(playerId, data.quantity);
        case ClientMsgType.BuyShipTradein:
            return handleBuyShipTradein(playerId, data.targetShipName);
        case ClientMsgType.GetAttackTargets:
            return handleGetAttackTargets(playerId);
        case ClientMsgType.StarbaseInfo:
            return handleStarbaseInfo(playerId);
        case ClientMsgType.TerraformInfo:
            return handleTerraformInfo(playerId);
        case ClientMsgType.HardwareStoreInfo:
            return handleHardwareStoreInfo(playerId);
        case ClientMsgType.AttackShip:
            return handleAttackShip(playerId, data.targetPlayerId, data.drones);
        case ClientMsgType.Dock:
            return handleDock(playerId);
        case ClientMsgType.Undock:
            return handleUndock(playerId);
        case ClientMsgType.Jettison:
            return handleJettison(playerId);
        case ClientMsgType.GetSectorPlanets:
            return handleGetSectorPlanets(playerId);
        case ClientMsgType.LandOnPlanet:
            return handleLandOnPlanet(playerId, data.planetId);
        case ClientMsgType.PlanetDisplay:
            return handlePlanetDisplay(playerId);
        case ClientMsgType.LeavePlanet:
            return handleLeavePlanet(playerId);
        case ClientMsgType.DestroyPlanet:
            return handleDestroyPlanet(playerId);
        case ClientMsgType.UseTerraformDevice:
            return handleUseTerraformDevice(playerId);
        case ClientMsgType.DockStarbase:
            return handleDockStarbase(playerId);
        case ClientMsgType.LeaveStarbase:
            return handleLeaveStarbase(playerId);
        case ClientMsgType.BuyHardware:
            return handleBuyHardware(playerId, data.itemName, data.quantity);
        case ClientMsgType.TakeColonists:
            return handleTakeColonists(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.LeaveColonists:
            return handleLeaveColonists(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.TakeCommodity:
            return handleTakeCommodity(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.LeaveCommodity:
            return handleLeaveCommodity(playerId, data.quantity, data.commodity ?? 'fuel');
        case ClientMsgType.ListPlanets:
            return handleListPlanets(playerId);
        case ClientMsgType.ListOwnedShips:
            return handleListOwnedShips(playerId);
        case ClientMsgType.TransportToShip: {
            const raw = data as { shipId?: unknown };
            if (typeof raw.shipId !== 'number') {
                sendError(playerId, 'Invalid ship id');
                return;
            }
            return handleTransportToShip(playerId, raw.shipId);
        }
        case ClientMsgType.ClanCreate: {
            const raw = data as { name?: unknown; password?: unknown };
            if (typeof raw.name !== 'string' || typeof raw.password !== 'string') {
                sendError(playerId, 'Invalid clan create payload');
                return;
            }
            return handleClanCreate(playerId, raw.name, raw.password);
        }
        case ClientMsgType.ClanJoin: {
            const raw = data as { name?: unknown; password?: unknown };
            if (typeof raw.name !== 'string' || typeof raw.password !== 'string') {
                sendError(playerId, 'Invalid clan join payload');
                return;
            }
            return handleClanJoin(playerId, raw.name, raw.password);
        }
        case ClientMsgType.ClanLeave: {
            const raw = data as { successorPlayerId?: unknown; confirmDissolve?: unknown };
            const successor =
                typeof raw.successorPlayerId === 'number' ? raw.successorPlayerId : undefined;
            const confirm = raw.confirmDissolve === true;
            return handleClanLeave(playerId, successor, confirm);
        }
        case ClientMsgType.ClanList:
            return handleClanList(playerId);
        case ClientMsgType.ClanInfo:
            return handleClanInfo(playerId);
        case ClientMsgType.ChangeShipOwnership: {
            const raw = data as { ownership?: unknown };
            if (raw.ownership !== 'personal' && raw.ownership !== 'clan') {
                sendError(playerId, 'Invalid ownership value');
                return;
            }
            return handleChangeShipOwnership(playerId, raw.ownership);
        }
        case ClientMsgType.ClaimPlanet: {
            const raw = data as { ownership?: unknown };
            if (raw.ownership !== 'personal' && raw.ownership !== 'clan') {
                sendError(playerId, 'Invalid ownership value');
                return;
            }
            return handleClaimPlanet(playerId, raw.ownership);
        }
        case ClientMsgType.ClanTransfer: {
            const raw = data as {
                kind?: unknown;
                targetPlayerId?: unknown;
                quantity?: unknown;
                mineType?: unknown;
            };
            if (
                raw.kind !== 'credits' &&
                raw.kind !== 'drones' &&
                raw.kind !== 'shields' &&
                raw.kind !== 'mines'
            ) {
                sendError(playerId, 'Invalid transfer kind');
                return;
            }
            if (typeof raw.targetPlayerId !== 'number' || typeof raw.quantity !== 'number') {
                sendError(playerId, 'Invalid transfer payload');
                return;
            }
            const mineType =
                raw.mineType === 'proximity' || raw.mineType === 'seeker'
                    ? raw.mineType
                    : undefined;
            return handleClanTransfer(
                playerId,
                raw.kind,
                raw.targetPlayerId,
                raw.quantity,
                mineType,
            );
        }
        case ClientMsgType.ClanMemo: {
            const raw = data as { body?: unknown };
            if (typeof raw.body !== 'string') {
                sendError(playerId, 'Invalid memo body');
                return;
            }
            return handleClanMemo(playerId, raw.body);
        }
        case ClientMsgType.ClanSetPassword: {
            const raw = data as { newPassword?: unknown };
            if (typeof raw.newPassword !== 'string') {
                sendError(playerId, 'Invalid password');
                return;
            }
            return handleClanSetPassword(playerId, raw.newPassword);
        }
        case ClientMsgType.ClanDropMember: {
            const raw = data as { targetPlayerId?: unknown };
            if (typeof raw.targetPlayerId !== 'number') {
                sendError(playerId, 'Invalid target');
                return;
            }
            return handleClanDropMember(playerId, raw.targetPlayerId);
        }
        case ClientMsgType.DeployDronesInfo:
            return handleDeployDronesInfo(playerId);
        case ClientMsgType.DeployDrones:
            return handleDeployDrones(playerId, data.quantity, data.ownership ?? 'personal');
        case ClientMsgType.AttackSectorDrones:
            return handleAttackSectorDrones(playerId, data.drones);
        case ClientMsgType.RetreatFromDrones:
            return handleRetreatFromDrones(playerId);
        case ClientMsgType.BuyShipNew:
            return handleBuyShipNew(playerId, data.targetShipName);
        case ClientMsgType.ListDeployedDrones:
            return handleListDeployedDrones(playerId);
        case ClientMsgType.HyperspaceJump:
            return handleHyperspaceJump(playerId, data.targetSector);
        case ClientMsgType.VisitedSectors:
            return handleVisitedSectors(playerId);
        case ClientMsgType.DeployMine: {
            const raw = data as {
                mineType?: unknown;
                quantity?: unknown;
                ownership?: unknown;
            };
            if (raw.mineType !== 'proximity' && raw.mineType !== 'seeker') {
                sendError(playerId, 'Invalid mine type');
                return;
            }
            if (typeof raw.quantity !== 'number') {
                sendError(playerId, 'Invalid quantity');
                return;
            }
            const ownership =
                raw.ownership === 'clan' || raw.ownership === 'personal'
                    ? raw.ownership
                    : 'personal';
            return handleDeployMine(playerId, raw.mineType, raw.quantity, ownership);
        }
        case ClientMsgType.ListDeployedMines:
            return handleListDeployedMines(playerId);
        case ClientMsgType.TrackSeekerMines:
            return handleTrackSeekerMines(playerId);
        case ClientMsgType.MineDisruptor: {
            const raw = data as { targetSector?: unknown };
            if (typeof raw.targetSector !== 'number') {
                sendError(playerId, 'Invalid target sector');
                return;
            }
            return handleMineDisruptor(playerId, raw.targetSector);
        }
        case ClientMsgType.GetNeighborhood: {
            const raw = data as {
                halfWidthWorld?: unknown;
                halfHeightWorld?: unknown;
                centerXWorld?: unknown;
                centerYWorld?: unknown;
            };
            if (typeof raw.halfWidthWorld !== 'number' || typeof raw.halfHeightWorld !== 'number') {
                sendError(
                    playerId,
                    'Invalid GET_NEIGHBORHOOD: halfWidthWorld and halfHeightWorld must be numbers',
                );
                return;
            }
            const cx = raw.centerXWorld;
            const cy = raw.centerYWorld;
            if (cx !== undefined && typeof cx !== 'number') {
                sendError(playerId, 'Invalid GET_NEIGHBORHOOD: centerXWorld must be a number');
                return;
            }
            if (cy !== undefined && typeof cy !== 'number') {
                sendError(playerId, 'Invalid GET_NEIGHBORHOOD: centerYWorld must be a number');
                return;
            }
            return handleGetNeighborhood(
                playerId,
                raw.halfWidthWorld,
                raw.halfHeightWorld,
                typeof cx === 'number' ? cx : undefined,
                typeof cy === 'number' ? cy : undefined,
            );
        }
        default:
            sendError(playerId, 'Unknown message type');
    }
}

async function handleVisitedSectors(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const sectors = await getVisitedSectors(playerId);
    const totalSectors = await countSectorsInUniverse(player.universeId);
    sendEnvelope(playerId, {
        type: ServerMsgType.VisitedSectorsResult,
        sectors,
        totalSectors,
    });
}

function handlePlayersOnline(playerId: number): void {
    const callerUniverse = players[playerId]?.universeId;
    const online = Object.entries(players)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    sendEnvelope(playerId, { type: ServerMsgType.PlayersOnlineResult, players: online });
}
