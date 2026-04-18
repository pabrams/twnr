import { ServerMsgType, ClientMsgType, Menu } from '@twnr/shared';
import type { ServerResult, MenuName } from '@twnr/shared';
import type { GameContext } from './types.js';

import { render } from './renderer.js';
import { NOTIFY, TRANSACTION, EVENT, PANEL } from './messages/index.js';
import { showSectorDisplay, showCommerceReport, showPrompt } from './display.js';
import { showClass0Menu, showAutopilotPrompt, showTradeQtyPrompt } from './display-port.js';
import {
    showPlanetMenu,
    showPlanetMenuOptions,
    showEarthMenu,
    showNoPlanet,
} from './display-planet.js';
import { showDroneEncounter } from './display-combat.js';
import {
    showStarbaseMenu,
    showHardwareMenu,
    showPlanetSelectMenu,
    showShipyardsMenu,
    showShipyardsClass0Menu,
} from './display-starbase.js';
import { renderVisitedSectorsResult, showComputerPrompt } from './display-computer.js';
import { PORT_CLASS_ACTIONS } from './constants.js';

function fmt(n: number): string {
    return n.toLocaleString();
}

export function setupConnection(ws: WebSocket, ctx: GameContext) {
    ws.addEventListener('open', () => {
        ctx.term.writeln(render(NOTIFY.connected));
    });

    ws.addEventListener('message', (event) => {
        const raw = JSON.parse(event.data);
        if (ctx.debug) {
            const lines = JSON.stringify(raw, null, 2).split('\n');
            ctx.term.writeln(`\r\n\x1b[38;5;243m← ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                ctx.term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }
        const msg: ServerResult = raw.payload ?? raw;
        if (raw.menu) {
            ctx.mode = raw.menu as MenuName;
        }
        switch (msg.type) {
            case ServerMsgType.Welcome:
                ctx.playerName = msg.name;
                ctx.playerId = msg.playerId;
                ctx.totalSectors = msg.totalSectors;
                ctx.currentShipName = msg.shipName;
                ctx.starbaseSector = msg.starbaseSector;
                ctx.term.writeln(render(NOTIFY.welcome, { name: msg.name }));
                ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case ServerMsgType.PlayerMoved:
                ctx.term.writeln(render(msg.direction === 'in' ? NOTIFY.playerIn : NOTIFY.playerOut));
                break;
            case ServerMsgType.RateLimited:
                if (ctx.autopilotPath.length > 0) {
                    const retrySector = ctx.autopilotPath[ctx.autopilotStep - 1];
                    if (retrySector !== undefined) {
                        setTimeout(() => {
                            ctx.sendMsg({ type: ClientMsgType.Move, sector: retrySector });
                        }, 200);
                    }
                }
                break;
            case ServerMsgType.SectorDisplayResult:
                ctx.sectorPlayers = msg.players;
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.sectorDrones,
                    msg.planets,
                    msg.ships,
                    msg.collisions,
                );
                if (ctx.autopilotPath.length > 0 && ctx.autopilotStep < ctx.autopilotPath.length) {
                    const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                    ctx.autopilotStep = ctx.autopilotStep + 1;
                    ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                } else if (ctx.autopilotPath.length > 0) {
                    ctx.autopilotPath = [];
                    ctx.autopilotStep = 0;
                }
                break;
            case ServerMsgType.DockResult:
                if (msg.docked && msg.port) {
                    ctx.dockedPortInfo = msg.port;
                    if (msg.port.class === 0) {
                        showClass0Menu(ctx);
                    } else {
                        const actions = PORT_CLASS_ACTIONS[msg.port.class];
                        if (!actions) break;
                        const cargo = msg.cargo ?? {
                            fuel: 0,
                            organics: 0,
                            equipment: 0,
                            colonists: 0,
                        };
                        const credits = msg.credits ?? 0;
                        const emptyHolds = msg.emptyHolds ?? 0;
                        const commodities = [
                            {
                                key: 'fuel',
                                label: 'Fuel',
                                trading: msg.port.fuel,
                                max: msg.port.fuelMax,
                                onBoard: cargo.fuel,
                            },
                            {
                                key: 'organics',
                                label: 'Organics',
                                trading: msg.port.organics,
                                max: msg.port.orgMax,
                                onBoard: cargo.organics,
                            },
                            {
                                key: 'equipment',
                                label: 'Equipment',
                                trading: msg.port.equipment,
                                max: msg.port.equMax,
                                onBoard: cargo.equipment,
                            },
                        ];
                        showCommerceReport(
                            ctx,
                            msg.port.portName,
                            msg.port.class,
                            commodities.map((c) => ({
                                name: c.label,
                                key: c.key,
                                status: actions[c.key] === 'B' ? 'Buying' : 'Selling',
                                trading: c.trading,
                                max: c.max,
                                onBoard: c.onBoard,
                            })),
                            credits,
                            emptyHolds,
                        );
                    }
                }
                break;
            case ServerMsgType.TradePrompt:
                showTradeQtyPrompt(
                    ctx,
                    msg.commodityLabel,
                    msg.action,
                    msg.portTrading,
                    msg.onBoard,
                    msg.maxQty,
                );
                break;
            case ServerMsgType.TradeConfirmPrompt: {
                const tpl = msg.action === 'buy' ? TRANSACTION.tradeConfirmSell : TRANSACTION.tradeConfirmBuy;
                ctx.term.writeln(render(tpl, { total: fmt(msg.totalPrice) }));
                ctx.term.write(render(TRANSACTION.tradeConfirmAccept));
                break;
            }
            case ServerMsgType.TradeComplete:
                ctx.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
                break;
            case ServerMsgType.TradeSkipped:
                ctx.term.writeln(render(TRANSACTION.tradeSkipped, { reason: msg.reason }));
                break;
            case ServerMsgType.UndockResult:
                if (msg.outcome === 'success') {
                    ctx.dockedPortInfo = null;
                    ctx.term.writeln(render(TRANSACTION.undocked));
                    ctx.sectorPlayers = msg.players;
                    showSectorDisplay(
                        ctx,
                        msg.sector,
                        msg.warps,
                        msg.players,
                        msg.port,
                        msg.sectorDrones,
                        msg.planets,
                        msg.ships,
                        msg.collisions,
                    );
                } else {
                    ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
                }
                break;
            case ServerMsgType.JettisonResult:
                if (msg.outcome === 'success') {
                    const j = msg.jettisoned;
                    const items = [
                        j.fuel > 0 ? `${j.fuel} fuel` : '',
                        j.organics > 0 ? `${j.organics} organics` : '',
                        j.equipment > 0 ? `${j.equipment} equipment` : '',
                        j.colonists > 0 ? `${j.colonists} colonists` : '',
                    ]
                        .filter(Boolean)
                        .join(', ');
                    ctx.term.writeln(
                        render(TRANSACTION.jettisoned, { items: items || 'nothing' }),
                    );
                } else {
                    ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
                }
                showPrompt(ctx);
                break;
            case ServerMsgType.PortTransactionResult:
                ctx.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
                break;
            case ServerMsgType.ShipInfoResult:
                ctx.currentShipName = msg.shipName;
                ctx.term.writeln(render(PANEL.shipName, { name: msg.shipName }));
                ctx.term.writeln(
                    render(PANEL.shipDronesShields, {
                        drones: msg.drones,
                        maxDrones: msg.maxDrones,
                        shields: msg.shields,
                        maxShields: msg.maxShields,
                    }),
                );
                ctx.term.writeln(
                    render(PANEL.shipHolds, {
                        free: msg.holdsAvailable,
                        total: msg.cargoLimit,
                        max: msg.maxHolds,
                    }),
                );
                ctx.term.writeln(
                    render(PANEL.shipCargo, {
                        fuel: msg.cargoFuel,
                        organics: msg.cargoOrganics,
                        equipment: msg.cargoEquipment,
                        colonists: msg.cargoColonists,
                    }),
                );
                ctx.term.writeln(
                    render(PANEL.shipCreditsTurns, { credits: msg.credits, turns: msg.turns }),
                );
                if (ctx.mode === Menu.Sector) showPrompt(ctx);
                break;
            case ServerMsgType.CargoInfoResult:
                ctx.term.writeln(render(PANEL.cargoInfoCredits, { credits: msg.credits }));
                break;
            case ServerMsgType.PlayersOnlineResult: {
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(PANEL.playersOnlineHeader, { count: msg.players.length }),
                );
                for (const p of msg.players) {
                    const suffix = p.id === ctx.playerId ? render(PANEL.playersOnlineYouTag) : '';
                    ctx.term.writeln(render(PANEL.playersOnlineRow, { name: p.name, suffix }));
                }
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.MoveResult:
                switch (msg.outcome) {
                    case 'success':
                        ctx.sectorPlayers = msg.players;
                        showSectorDisplay(
                            ctx,
                            msg.sector,
                            msg.warps,
                            msg.players,
                            msg.port,
                            msg.sectorDrones,
                            msg.planets,
                            msg.ships,
                            msg.collisions,
                        );
                        if (
                            ctx.autopilotPath.length > 0 &&
                            ctx.autopilotStep < ctx.autopilotPath.length
                        ) {
                            const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                            ctx.autopilotStep = ctx.autopilotStep + 1;
                            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                        } else if (ctx.autopilotPath.length > 0) {
                            ctx.autopilotPath = [];
                            ctx.autopilotStep = 0;
                        }
                        break;
                    case 'encounter': {
                        ctx.sectorPlayers = msg.players;
                        ctx.visitedSet.add(msg.sector);
                        ctx.currentSector = msg.sector;
                        ctx.currentPort = msg.port ?? null;
                        ctx.encounterOwnerName = msg.ownerName;
                        showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
                        if (ctx.autopilotPath.length > 0) {
                            ctx.autopilotPaused = true;
                            ctx.term.writeln(render(EVENT.autopilotDisengaged));
                        }
                        showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
                        break;
                    }
                    case 'nonAdjacent':
                        ctx.sendMsg({
                            type: ClientMsgType.ShortestPath,
                            from: ctx.currentSector,
                            to: msg.sector,
                        });
                        break;
                    case 'noShip':
                        if (ctx.autopilotPath.length > 0) {
                            ctx.autopilotPath = [];
                            ctx.autopilotStep = 0;
                            ctx.autopilotPaused = false;
                            ctx.term.writeln(render(EVENT.autopilotCancelled));
                        }
                        ctx.term.writeln(render(EVENT.noShip));
                        showPrompt(ctx);
                        break;
                    case 'error':
                        if (ctx.autopilotPath.length > 0) {
                            ctx.autopilotPath = [];
                            ctx.autopilotStep = 0;
                            ctx.autopilotPaused = false;
                            ctx.term.writeln(render(EVENT.autopilotCancelled));
                        }
                        ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
                        showPrompt(ctx);
                        break;
                }
                break;
            case ServerMsgType.NonAdjacentMoveRequested:
                ctx.sendMsg({
                    type: ClientMsgType.ShortestPath,
                    from: ctx.currentSector,
                    to: msg.sector,
                });
                break;
            case ServerMsgType.ShortestPathResult:
                if (msg.path.length > 1) {
                    showAutopilotPrompt(ctx, msg.path, msg.hops);
                } else {
                    ctx.term.writeln(render(EVENT.noPathFound));
                    showPrompt(ctx);
                }
                break;
            case ServerMsgType.BuyDronesResult:
                ctx.term.writeln(render(TRANSACTION.purchaseComplete));
                ctx.term.writeln(
                    render(TRANSACTION.purchaseStatsDrones, {
                        credits: msg.credits,
                        drones: msg.drones,
                    }),
                );
                if (ctx.mode === Menu.Class0Qty) showClass0Menu(ctx);
                else if (ctx.mode === Menu.ShipyardsClass0Qty) showShipyardsClass0Menu(ctx);
                break;
            case ServerMsgType.BuyShieldsResult:
                ctx.term.writeln(render(TRANSACTION.purchaseComplete));
                ctx.term.writeln(
                    render(TRANSACTION.purchaseStatsShields, {
                        credits: msg.credits,
                        shields: msg.shields,
                    }),
                );
                if (ctx.mode === Menu.Class0Qty) showClass0Menu(ctx);
                else if (ctx.mode === Menu.ShipyardsClass0Qty) showShipyardsClass0Menu(ctx);
                break;
            case ServerMsgType.BuyHoldsResult:
                ctx.term.writeln(render(TRANSACTION.purchaseComplete));
                ctx.term.writeln(
                    render(TRANSACTION.purchaseStatsHolds, {
                        credits: msg.credits,
                        holds: msg.cargoLimit,
                    }),
                );
                if (ctx.mode === Menu.Class0Qty) showClass0Menu(ctx);
                else if (ctx.mode === Menu.ShipyardsClass0Qty) showShipyardsClass0Menu(ctx);
                break;
            case ServerMsgType.AttackShipResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(msg.destroyed ? EVENT.attackDestroyed : EVENT.attackCompleted, {
                        message: msg.message || (msg.destroyed ? 'Target destroyed!' : 'Attack completed.'),
                    }),
                );
                ctx.term.writeln(
                    render(EVENT.attackStat, {
                        label: 'Your drones lost',
                        value: msg.attackerDronesLost,
                    }),
                );
                ctx.term.writeln(
                    render(EVENT.attackStat, {
                        label: 'Defender shields lost',
                        value: msg.defenderShieldsLost,
                    }),
                );
                ctx.term.writeln(
                    render(EVENT.attackStat, {
                        label: 'Defender drones lost',
                        value: msg.defenderDronesLost,
                    }),
                );
                showPrompt(ctx);
                break;
            case ServerMsgType.BuyShipTradeinResult:
                ctx.currentShipName = msg.shipName;
                ctx.term.writeln(render(TRANSACTION.shipExchanged, { name: msg.shipName }));
                ctx.term.writeln(
                    render(TRANSACTION.shipCreditsLine, { credits: fmt(msg.credits) }),
                );
                showShipyardsMenu(ctx);
                break;
            case ServerMsgType.BuyShipNewResult:
                ctx.currentShipName = msg.shipName;
                ctx.term.writeln(render(TRANSACTION.shipPurchased, { name: msg.shipName }));
                ctx.term.writeln(
                    render(TRANSACTION.shipCreditsLine, { credits: fmt(msg.credits) }),
                );
                showShipyardsMenu(ctx);
                break;
            case ServerMsgType.PlanetInfoResult:
                if (msg.hasPlanet) showPlanetMenu(ctx, msg.name, msg.colonists);
                else showNoPlanet(ctx);
                break;
            case ServerMsgType.TakeColonistsResult: {
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(PANEL.takeColonistsHeader, {
                        qty: fmt(msg.quantity),
                        commodity: msg.commodity,
                    }),
                );
                ctx.term.writeln(
                    render(PANEL.planetColonistsLine, { count: fmt(msg.planetColonists) }),
                );
                ctx.term.writeln(
                    render(PANEL.shipColonistsLine, { count: msg.shipColonists }),
                );
                break;
            }
            case ServerMsgType.LeaveColonistsResult: {
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(PANEL.leaveColonistsHeader, {
                        qty: fmt(msg.quantity),
                        commodity: msg.commodity,
                    }),
                );
                ctx.term.writeln(
                    render(PANEL.planetColonistsLine, { count: fmt(msg.planetColonists) }),
                );
                ctx.term.writeln(
                    render(PANEL.shipColonistsLine, { count: msg.shipColonists }),
                );
                break;
            }
            case ServerMsgType.DroneEncounter: {
                ctx.sectorPlayers = msg.players;
                ctx.visitedSet.add(msg.sector);
                ctx.currentSector = msg.sector;
                ctx.currentPort = msg.port ?? null;
                ctx.encounterOwnerName = msg.ownerName;
                showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
                if (ctx.autopilotPath.length > 0) {
                    ctx.autopilotPaused = true;
                    ctx.term.writeln(render(EVENT.autopilotDisengaged));
                }
                showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
                break;
            }
            case ServerMsgType.DeployDronesInfoResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(EVENT.deployDronesInfo, {
                        sector: msg.sectorDrones,
                        ship: msg.shipDrones,
                        max: msg.shipMaxDrones,
                    }),
                );
                ctx.term.write(render(EVENT.deployDronesPrompt));
                break;
            case ServerMsgType.DeployDronesResult:
                ctx.term.writeln(
                    render(EVENT.deployDronesResult, {
                        sector: msg.sectorDrones,
                        ship: msg.shipDrones,
                    }),
                );
                showPrompt(ctx);
                break;
            case ServerMsgType.AttackSectorDronesResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(EVENT.combatLost, {
                        lost: msg.dronesLost,
                        remaining: msg.sectorDronesRemaining,
                        ship: msg.shipDrones,
                    }),
                );
                if (msg.victory) {
                    ctx.term.writeln(render(EVENT.sectorCleared));
                    if (ctx.autopilotPaused) {
                        ctx.term.writeln(render(EVENT.autopilotResuming));
                        ctx.autopilotPaused = false;
                        ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                    } else {
                        showPrompt(ctx);
                    }
                } else {
                    showDroneEncounter(
                        ctx,
                        msg.sectorDronesRemaining,
                        ctx.encounterOwnerName,
                        msg.shipDrones,
                    );
                }
                break;
            case ServerMsgType.RetreatFromDronesResult:
                ctx.term.writeln(render(EVENT.retreated, { sector: msg.sector }));
                if (ctx.autopilotPaused) {
                    ctx.autopilotPath = [];
                    ctx.autopilotStep = 0;
                    ctx.autopilotPaused = false;
                    ctx.term.writeln(render(EVENT.autopilotCancelled));
                }
                break;
            case ServerMsgType.SectorDronesAlert: {
                ctx.term.writeln('');
                const tpl =
                    msg.event === 'intrusion'
                        ? EVENT.alertIntrusion
                        : msg.event === 'attacked'
                          ? EVENT.alertAttacked
                          : msg.event === 'destroyed'
                            ? EVENT.alertDestroyed
                            : null;
                if (tpl) {
                    const vars: Record<string, unknown> = {
                        intruder: msg.intruderName,
                        sector: msg.sector,
                    };
                    if (msg.event === 'attacked') {
                        vars.lost = msg.dronesLost;
                        vars.remaining = msg.dronesRemaining;
                    }
                    ctx.term.writeln(render(tpl, vars));
                }
                break;
            }
            case ServerMsgType.DockStarbaseResult:
                ctx.hardwarePrices = msg.prices;
                showStarbaseMenu(ctx);
                break;
            case ServerMsgType.LeaveStarbaseResult:
                ctx.sectorPlayers = msg.players;
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.sectorDrones,
                    msg.planets,
                    msg.ships,
                    msg.collisions,
                );
                break;
            case ServerMsgType.LandResult:
                if (msg.planets.length > 0) {
                    ctx.landablePlanets = msg.planets;
                    showPlanetSelectMenu(ctx, msg.planets);
                } else {
                    ctx.term.writeln(render(EVENT.noPlanetsToLand));
                    showPrompt(ctx);
                }
                break;
            case ServerMsgType.LandOnPlanetResult:
                if (ctx.mode === Menu.PlanetEarth) {
                    showEarthMenu(ctx, msg.colonists_fuel ?? 0);
                } else {
                    ctx.term.writeln('');
                    ctx.term.writeln(render(PANEL.landedHeader, { name: msg.name }));
                    ctx.term.writeln(render(PANEL.landedType, { type: msg.planetType }));
                    ctx.term.writeln(
                        render(PANEL.landedStats, {
                            drones: msg.drones,
                            fuel: msg.fuel,
                            organics: msg.organics,
                            equipment: msg.equipment,
                        }),
                    );
                    ctx.term.writeln(
                        render(PANEL.landedColonists, {
                            fuel: msg.colonists_fuel ?? 0,
                            organics: msg.colonists_organics ?? 0,
                            equipment: msg.colonists_equipment ?? 0,
                        }),
                    );
                    showPlanetMenuOptions(ctx);
                }
                break;
            case ServerMsgType.PlanetDisplayResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(PANEL.planetDisplayHeader, { name: msg.name, type: msg.planetType }),
                );
                ctx.term.writeln(
                    render(PANEL.landedStats, {
                        drones: msg.drones,
                        fuel: msg.fuel,
                        organics: msg.organics,
                        equipment: msg.equipment,
                    }),
                );
                ctx.term.writeln(
                    render(PANEL.landedColonists, {
                        fuel: msg.colonists_fuel,
                        organics: msg.colonists_organics,
                        equipment: msg.colonists_equipment,
                    }),
                );
                break;
            case ServerMsgType.DestroyPlanetResult:
                if (msg.destroyed) {
                    ctx.term.writeln(render(EVENT.planetDestroyed, { name: msg.planetName }));
                }
                showPrompt(ctx);
                break;
            case ServerMsgType.UseTerraformDeviceResult:
                if (msg.success && msg.planet) {
                    ctx.term.writeln(
                        render(EVENT.terraformSuccess, {
                            name: msg.planet.name,
                            type: msg.planet.type,
                        }),
                    );
                    if (msg.collision) ctx.term.writeln(render(EVENT.terraformCollision));
                    ctx.term.writeln(
                        render(EVENT.terraformDevicesRemaining, { count: msg.terraformDevices }),
                    );
                } else {
                    const reason =
                        msg.reason === 'no_devices'
                            ? 'No terraform devices on ship.'
                            : msg.reason === 'restricted_sector'
                              ? 'Cannot terraform in this sector.'
                              : 'Terraform failed.';
                    ctx.term.writeln(render(EVENT.terraformFailure, { reason }));
                }
                showPrompt(ctx);
                break;
            case ServerMsgType.BuyHardwareResult:
                if (msg.kind === 'toggle') {
                    ctx.term.writeln(
                        render(TRANSACTION.hardwareInstalled, {
                            label: msg.label,
                            credits: msg.credits,
                        }),
                    );
                } else {
                    ctx.term.writeln(
                        render(TRANSACTION.hardwareStacked, {
                            label: msg.label,
                            total: msg.totalOnShip,
                            credits: msg.credits,
                        }),
                    );
                }
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.ListDeployedDronesResult:
                ctx.term.writeln('');
                if (msg.drones.length === 0) {
                    ctx.term.writeln(render(PANEL.deployedDronesEmpty));
                } else {
                    ctx.term.writeln(render(PANEL.deployedDronesHeader));
                    for (const d of msg.drones) {
                        ctx.term.writeln(
                            render(PANEL.deployedDronesRow, { sector: d.sectorId, qty: d.quantity }),
                        );
                    }
                }
                showPrompt(ctx);
                break;
            case ServerMsgType.HyperspaceJumpResult:
                ctx.term.writeln(
                    render(EVENT.hyperspaceJump, {
                        sector: msg.targetSector,
                        fuel: msg.fuelUsed,
                        turns: msg.turnsUsed,
                    }),
                );
                ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case ServerMsgType.LeavePlanetResult:
                ctx.term.writeln(render(EVENT.leftPlanet));
                ctx.sectorPlayers = msg.players;
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.sectorDrones,
                    msg.planets,
                    msg.ships,
                    msg.collisions,
                );
                break;
            case ServerMsgType.MenuChanged:
                break;
            case ServerMsgType.VisitedSectorsResult:
                renderVisitedSectorsResult(ctx, msg);
                break;
            case ServerMsgType.ListPlanetsResult: {
                ctx.term.writeln('');
                if (msg.planets.length === 0) {
                    ctx.term.writeln(render(PANEL.listPlanetsEmpty));
                } else {
                    ctx.term.writeln(render(PANEL.listPlanetsHeader));
                    for (const p of msg.planets) {
                        ctx.term.writeln(
                            render(PANEL.listPlanetsRow, {
                                sector: p.sectorNumber,
                                name: p.name,
                                type: p.type,
                            }),
                        );
                        ctx.term.writeln(
                            render(PANEL.listPlanetsColonists, {
                                fuel: p.colonists_fuel,
                                organics: p.colonists_organics,
                                equipment: p.colonists_equipment,
                            }),
                        );
                    }
                }
                showComputerPrompt(ctx);
                break;
            }
            case ServerMsgType.Error:
                ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
                if (ctx.mode === Menu.TradeQty || ctx.mode === Menu.TradeConfirm) {
                    ctx.sendMsg({ type: ClientMsgType.Undock });
                } else if (ctx.mode === Menu.DeployDronesQty) {
                    showPrompt(ctx);
                } else if (ctx.mode === Menu.DroneEncounter || ctx.mode === Menu.DroneAttackQty) {
                    // stay in encounter mode
                } else if (ctx.mode.startsWith(Menu.Shipyards)) {
                    showShipyardsMenu(ctx);
                } else if (ctx.mode === Menu.Sector) showPrompt(ctx);
                break;
        }
    });
    ws.addEventListener('error', () => {
        ctx.term.writeln(render(NOTIFY.connectionError));
    });
}
