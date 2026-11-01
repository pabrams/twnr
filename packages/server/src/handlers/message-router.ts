import { Commands, commandNameByType, type ClientEnvelope, type CommandName } from '@twnr/shared';
import { sendEnvelope } from '../state/messaging.js';
import { onlinePlayers } from '../state/players.js';
import { getPendingShipPurchase } from '../state/pending-ship-purchases.js';
import { serveSetShipName } from './ship-name.js';
import { serveTowSpacecraft, serveTowAttach } from './tow.js';
import { serveReadMail, serveDeleteAllMail, serveCheckMailSinceLastLogout } from './mail.js';
import { serveHailResolve, serveHailSend } from './hail.js';
import { serveGalacticNewsRange, serveReadGalacticNews } from './galactic-news.js';
import { serveVisitedSectors } from './visited.js';
import { servePlayersOnline, serveTraderList } from './players.js';
import { serveShipCatalog, servePlanetCatalog, serveHardwareCatalog } from './catalog.js';
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
    serveBwarpInfo,
    serveBwarpInstall,
    serveBwarpUpgrade,
    serveBwarpBeam,
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
    serveSetTerraformedPlanet,
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
    serveClanmateLocations,
} from './clan.js';
import { serveReleaseBeacon, serveAttackBeacon } from './beacon.js';
import { serveDensityScan, serveVisualScan } from './long-range-scan.js';
import { commandRefusal, type Handler } from './command.js';

type HandlerMap = { [K in CommandName]: Handler<K> };

const handlers: HandlerMap = {
    Move: serveMove,
    MoveToPrevious: serveMoveToPrevious,
    SectorDisplay: serveSectorDisplay,
    PlayersOnline: servePlayersOnline,
    WarpsOut: serveWarpsOut,
    ShortestPath: serveShortestPath,
    PortInfo: servePortInfo,
    ShipInfo: serveShipInfo,
    PortTransaction: servePortTransaction,
    BuyDrones: serveBuyDrones,
    BuyShields: serveBuyShields,
    BuyHolds: serveBuyHolds,
    BuyShipTradein: serveBuyShipTradein,
    GetAttackTargets: serveGetAttackTargets,
    StarbaseInfo: serveStarbaseInfo,
    TerraformInfo: serveTerraformInfo,
    HardwareStoreInfo: serveHardwareStoreInfo,
    AttackShip: serveAttackShip,
    Dock: serveDock,
    Undock: serveUndock,
    Jettison: serveJettison,
    GetSectorPlanets: serveGetSectorPlanets,
    LandOnPlanet: serveLandOnPlanet,
    PlanetDisplay: servePlanetDisplay,
    LeavePlanet: serveLeavePlanet,
    DestroyPlanet: serveDestroyPlanet,
    UseTerraformDevice: serveUseTerraformDevice,
    SetTerraformedPlanet: serveSetTerraformedPlanet,
    DockStarbase: serveDockStarbase,
    LeaveStarbase: serveLeaveStarbase,
    BuyHardware: serveBuyHardware,
    TakeColonists: serveTakeColonists,
    LeaveColonists: serveLeaveColonists,
    TakeCommodity: serveTakeCommodity,
    LeaveCommodity: serveLeaveCommodity,
    ChangePopulation: serveChangePopulation,
    ListPlanets: serveListPlanets,
    ListOwnedShips: serveListOwnedShips,
    GetShipDetail: serveGetShipDetail,
    TransportToShip: serveTransportToShip,
    ClanCreate: serveClanCreate,
    ClanJoin: serveClanJoin,
    ClanLeave: serveClanLeave,
    ClanList: serveClanList,
    ClanInfo: serveClanInfo,
    ChangeShipOwnership: serveChangeShipOwnership,
    ClaimPlanet: serveClaimPlanet,
    ClanTransfer: serveClanTransfer,
    ClanMemo: serveClanMemo,
    ClanSetPassword: serveClanSetPassword,
    ClanDropMember: serveClanDropMember,
    ClanmateLocations: serveClanmateLocations,
    DeployDronesInfo: serveDeployDronesInfo,
    DeployDrones: serveDeployDrones,
    AttackSectorDrones: serveAttackSectorDrones,
    RetreatFromDrones: serveRetreatFromDrones,
    BuyShipNew: serveBuyShipNew,
    ListDeployedDrones: serveListDeployedDrones,
    HyperspaceJump: serveHyperspaceJump,
    VisitedSectors: serveVisitedSectors,
    DeployMineInfo: serveDeployMineInfo,
    DeployMine: serveDeployMine,
    ListDeployedMines: serveListDeployedMines,
    TrackSeekerMines: serveTrackSeekerMines,
    MineDisruptor: serveMineDisruptor,
    GetNeighborhood: serveGetNeighborhood,
    ReleaseBeacon: serveReleaseBeacon,
    AttackBeacon: serveAttackBeacon,
    DensityScan: serveDensityScan,
    VisualScan: serveVisualScan,
    SetShipName: serveSetShipName,
    TowSpacecraft: serveTowSpacecraft,
    TowAttach: serveTowAttach,
    ReadMail: serveReadMail,
    CheckMailSinceLastLogout: serveCheckMailSinceLastLogout,
    DeleteAllMail: serveDeleteAllMail,
    HailResolve: serveHailResolve,
    HailSend: serveHailSend,
    ConstructPortInfo: serveConstructPortInfo,
    BuildPort: serveBuildPort,
    UpgradePortInfo: serveUpgradePortInfo,
    UpgradePort: serveUpgradePort,
    HaggleOpen: serveHaggleOpen,
    HaggleCounter: serveHaggleCounter,
    HaggleAccept: serveHaggleAccept,
    HaggleQuit: serveHaggleQuit,
    BaseInfo: serveBaseInfo,
    BuildBase: serveBuildBase,
    ExitBase: serveExitBase,
    TreasuryInfo: serveTreasuryInfo,
    TreasuryTransfer: serveTreasuryTransfer,
    BwarpInfo: serveBwarpInfo,
    BwarpInstall: serveBwarpInstall,
    BwarpUpgrade: serveBwarpUpgrade,
    BwarpBeam: serveBwarpBeam,
    ShipCatalog: serveShipCatalog,
    PlanetCatalog: servePlanetCatalog,
    HardwareCatalog: serveHardwareCatalog,
    TraderList: serveTraderList,
    GalacticNewsRange: serveGalacticNewsRange,
    ReadGalacticNews: serveReadGalacticNews,
};

/** Dispatches one client command, sends its reply, and returns the outcome recorded in command_log. */
export async function routeMessage(playerId: number, data: ClientEnvelope): Promise<string> {
    const name = commandNameByType.get(data.type);
    if (name === undefined) throw new Error(`No handler registered for ${data.type}`);
    const reply = Commands[name].reply;

    if (name !== 'SetShipName') {
        const needsName =
            onlinePlayers[playerId] !== undefined && getPendingShipPurchase(playerId) !== undefined;
        if (needsName) {
            const refusal = commandRefusal('shipNameRequired');
            if (reply) sendEnvelope(playerId, { type: reply.name, ...refusal } as never);
            return refusal.outcome;
        }
    }

    const handler = handlers[name] as Handler<CommandName>;
    const result = await handler(playerId, data as never);
    if (reply === null) return 'ok';
    if (result === undefined) return 'noReply';
    sendEnvelope(playerId, { type: reply.name, outcome: 'ok', ...result } as never);
    return (result as { outcome?: string }).outcome ?? 'ok';
}
