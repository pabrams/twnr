import { ClientTag, type ClientEnvelope } from '@twnr/shared';
import { sendError } from '../state/messaging.js';
import { players } from '../state/players.js';
import { getPendingShipPurchase } from '../state/pending-ship-purchases.js';
import { serveSetShipName } from './ship-name.js';
import { serveTowSpacecraft, serveTowAttach } from './tow.js';
import { serveReadMail, serveDeleteAllMail, serveCheckMailSinceLastLogout } from './mail.js';
import { serveHailResolve, serveHailSend } from './hail.js';
import { serveVisitedSectors } from './visited.js';
import { servePlayersOnline } from './players.js';
import {
    serveMove,
    serveMoveToPrevious,
    serveSectorDisplay,
    serveWarpsOut,
    serveShortestPath,
} from './movement.js';
import {
    servePortInfo,
    serveDock,
    serveUndock,
    servePortTransaction,
    serveDockStarbase,
    serveLeaveStarbase,
} from './port.js';
import {
    serveConstructPortInfo,
    serveBuildPort,
    serveUpgradePortInfo,
    serveUpgradePort,
} from './port-construction.js';
import {
    serveHaggleOpen,
    serveHaggleCounter,
    serveHaggleAccept,
    serveHaggleQuit,
} from './port-haggle.js';
import {
    serveBaseInfo,
    serveBuildBase,
    serveExitBase,
    serveTreasuryInfo,
    serveTreasuryTransfer,
} from './base.js';
import {
    serveShipInfo,
    serveListOwnedShips,
    serveTransportToShip,
    serveChangeShipOwnership,
    serveGetShipDetail,
} from './ship-info.js';
import { serveStarbaseInfo } from './starbase-info.js';
import { serveBuyDrones, serveBuyShields, serveBuyHolds } from './ship-upgrades.js';
import { serveBuyShipTradein, serveBuyShipNew } from './ship-exchange.js';
import { serveJettison } from './ship-cargo.js';
import { serveGetAttackTargets, serveAttackShip } from './combat.js';
import {
    serveGetSectorPlanets,
    serveLandOnPlanet,
    servePlanetDisplay,
    serveLeavePlanet,
    serveDestroyPlanet,
    serveUseTerraformDevice,
    serveTerraformInfo,
    serveTakeColonists,
    serveLeaveColonists,
    serveTakeCommodity,
    serveLeaveCommodity,
    serveChangePopulation,
    serveListPlanets,
    serveClaimPlanet,
} from './planet.js';
import {
    serveDeployDronesInfo,
    serveDeployDrones,
    serveAttackSectorDrones,
    serveRetreatFromDrones,
    serveListDeployedDrones,
} from './sector-drones.js';
import { serveHyperspaceJump } from './hyperwarp.js';
import { serveBuyHardware, serveHardwareStoreInfo } from './hardware-store.js';
import { serveGetNeighborhood } from './neighborhood.js';
import {
    serveDeployMine,
    serveDeployMineInfo,
    serveListDeployedMines,
    serveTrackSeekerMines,
    serveMineDisruptor,
} from './mines.js';
import {
    serveClanCreate,
    serveClanJoin,
    serveClanLeave,
    serveClanList,
    serveClanInfo,
    serveClanTransfer,
    serveClanMemo,
    serveClanSetPassword,
    serveClanDropMember,
} from './clan.js';
import { serveReleaseBeacon, serveAttackBeacon } from './beacon.js';
import { serveDensityScan, serveVisualScan } from './long-range-scan.js';

type ClientCommandByType = { [C in ClientEnvelope as C['type']]: C };

/** A handler receives the player id and the typed command envelope. */
export type Handler<K extends ClientEnvelope['type']> = (
    playerId: number,
    data: ClientCommandByType[K],
) => void | Promise<void>;

type HandlerMap = { [K in ClientEnvelope['type']]: Handler<K> };

const handlers: HandlerMap = {
    [ClientTag.Move]: serveMove,
    [ClientTag.MoveToPrevious]: serveMoveToPrevious,
    [ClientTag.SectorDisplay]: serveSectorDisplay,
    [ClientTag.PlayersOnline]: servePlayersOnline,
    [ClientTag.WarpsOut]: serveWarpsOut,
    [ClientTag.ShortestPath]: serveShortestPath,
    [ClientTag.PortInfo]: servePortInfo,
    [ClientTag.ShipInfo]: serveShipInfo,
    [ClientTag.PortTransaction]: servePortTransaction,
    [ClientTag.BuyDrones]: serveBuyDrones,
    [ClientTag.BuyShields]: serveBuyShields,
    [ClientTag.BuyHolds]: serveBuyHolds,
    [ClientTag.BuyShipTradein]: serveBuyShipTradein,
    [ClientTag.GetAttackTargets]: serveGetAttackTargets,
    [ClientTag.StarbaseInfo]: serveStarbaseInfo,
    [ClientTag.TerraformInfo]: serveTerraformInfo,
    [ClientTag.HardwareStoreInfo]: serveHardwareStoreInfo,
    [ClientTag.AttackShip]: serveAttackShip,
    [ClientTag.Dock]: serveDock,
    [ClientTag.Undock]: serveUndock,
    [ClientTag.Jettison]: serveJettison,
    [ClientTag.GetSectorPlanets]: serveGetSectorPlanets,
    [ClientTag.LandOnPlanet]: serveLandOnPlanet,
    [ClientTag.PlanetDisplay]: servePlanetDisplay,
    [ClientTag.LeavePlanet]: serveLeavePlanet,
    [ClientTag.DestroyPlanet]: serveDestroyPlanet,
    [ClientTag.UseTerraformDevice]: serveUseTerraformDevice,
    [ClientTag.DockStarbase]: serveDockStarbase,
    [ClientTag.LeaveStarbase]: serveLeaveStarbase,
    [ClientTag.BuyHardware]: serveBuyHardware,
    [ClientTag.TakeColonists]: serveTakeColonists,
    [ClientTag.LeaveColonists]: serveLeaveColonists,
    [ClientTag.TakeCommodity]: serveTakeCommodity,
    [ClientTag.LeaveCommodity]: serveLeaveCommodity,
    [ClientTag.ChangePopulation]: serveChangePopulation,
    [ClientTag.ListPlanets]: serveListPlanets,
    [ClientTag.ListOwnedShips]: serveListOwnedShips,
    [ClientTag.GetShipDetail]: serveGetShipDetail,
    [ClientTag.TransportToShip]: serveTransportToShip,
    [ClientTag.ClanCreate]: serveClanCreate,
    [ClientTag.ClanJoin]: serveClanJoin,
    [ClientTag.ClanLeave]: serveClanLeave,
    [ClientTag.ClanList]: serveClanList,
    [ClientTag.ClanInfo]: serveClanInfo,
    [ClientTag.ChangeShipOwnership]: serveChangeShipOwnership,
    [ClientTag.ClaimPlanet]: serveClaimPlanet,
    [ClientTag.ClanTransfer]: serveClanTransfer,
    [ClientTag.ClanMemo]: serveClanMemo,
    [ClientTag.ClanSetPassword]: serveClanSetPassword,
    [ClientTag.ClanDropMember]: serveClanDropMember,
    [ClientTag.DeployDronesInfo]: serveDeployDronesInfo,
    [ClientTag.DeployDrones]: serveDeployDrones,
    [ClientTag.AttackSectorDrones]: serveAttackSectorDrones,
    [ClientTag.RetreatFromDrones]: serveRetreatFromDrones,
    [ClientTag.BuyShipNew]: serveBuyShipNew,
    [ClientTag.ListDeployedDrones]: serveListDeployedDrones,
    [ClientTag.HyperspaceJump]: serveHyperspaceJump,
    [ClientTag.VisitedSectors]: serveVisitedSectors,
    [ClientTag.DeployMineInfo]: serveDeployMineInfo,
    [ClientTag.DeployMine]: serveDeployMine,
    [ClientTag.ListDeployedMines]: serveListDeployedMines,
    [ClientTag.TrackSeekerMines]: serveTrackSeekerMines,
    [ClientTag.MineDisruptor]: serveMineDisruptor,
    [ClientTag.GetNeighborhood]: serveGetNeighborhood,
    [ClientTag.ReleaseBeacon]: serveReleaseBeacon,
    [ClientTag.AttackBeacon]: serveAttackBeacon,
    [ClientTag.DensityScan]: serveDensityScan,
    [ClientTag.VisualScan]: serveVisualScan,
    [ClientTag.SetShipName]: serveSetShipName,
    [ClientTag.TowSpacecraft]: serveTowSpacecraft,
    [ClientTag.TowAttach]: serveTowAttach,
    [ClientTag.ReadMail]: serveReadMail,
    [ClientTag.CheckMailSinceLastLogout]: serveCheckMailSinceLastLogout,
    [ClientTag.DeleteAllMail]: serveDeleteAllMail,
    [ClientTag.HailResolve]: serveHailResolve,
    [ClientTag.HailSend]: serveHailSend,
    [ClientTag.ConstructPortInfo]: (pid) => serveConstructPortInfo(pid),
    [ClientTag.BuildPort]: serveBuildPort,
    [ClientTag.UpgradePortInfo]: (pid) => serveUpgradePortInfo(pid),
    [ClientTag.UpgradePort]: serveUpgradePort,
    [ClientTag.HaggleOpen]: serveHaggleOpen,
    [ClientTag.HaggleCounter]: serveHaggleCounter,
    [ClientTag.HaggleAccept]: (pid) => serveHaggleAccept(pid),
    [ClientTag.HaggleQuit]: (pid) => {
        serveHaggleQuit(pid);
    },
    [ClientTag.BaseInfo]: (pid) => serveBaseInfo(pid),
    [ClientTag.BuildBase]: (pid) => serveBuildBase(pid),
    [ClientTag.ExitBase]: (pid) => serveExitBase(pid),
    [ClientTag.TreasuryInfo]: (pid) => serveTreasuryInfo(pid),
    [ClientTag.TreasuryTransfer]: (pid, data) =>
        serveTreasuryTransfer(pid, { direction: data.direction, amount: data.amount }),
};

export async function routeMessage(playerId: number, data: ClientEnvelope): Promise<void> {
    // Naming gate: while the player has no ship (initial / post-respawn) or a
    // pending ship purchase, the only command we accept is SetShipName.
    if (data.type !== ClientTag.SetShipName) {
        const player = players[playerId];
        const needsName =
            player !== undefined &&
            (player.shipId === null || getPendingShipPurchase(playerId) !== undefined);
        if (needsName) {
            sendError(playerId, 'Name your ship first.');
            return;
        }
    }
    const handler = handlers[data.type] as
        | ((pid: number, d: ClientEnvelope) => void | Promise<void>)
        | undefined;
    if (!handler) {
        sendError(playerId, 'Unknown message type');
        return;
    }
    await handler(playerId, data);
}
