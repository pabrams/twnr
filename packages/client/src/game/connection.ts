import { ServerMsgType, ClientMsgType, Menu } from '@twnr/shared';
import type { ServerResult, MenuName } from '@twnr/shared';
import type { GameContext } from './types.js';

import { render } from './renderer.js';
import { NOTIFY, TRANSACTION, EVENT, PANEL, PORT, SECTOR } from './messages/index.js';
import { getMenuHandler } from './menus/index.js';
import {
    showSectorDisplay,
    showCommerceReport,
    showPrompt,
    showMoveMenu,
    showPortMenu,
} from './display.js';
import { showClass0Menu, showAutopilotPrompt, showTradeQtyPrompt } from './display-port.js';
import {
    showPlanetMenu,
    showPlanetMenuOptions,
    showEarthMenu,
    showNoPlanet,
} from './display-planet.js';
import { showDroneEncounter, showAttackMenu } from './display-combat.js';
import {
    showStarbaseMenu,
    showHardwareMenu,
    showPlanetSelectMenu,
    showShipyardsMenu,
} from './display-starbase.js';
import { renderVisitedSectorsResult, showComputerPrompt } from './display-computer.js';
import { PORT_CLASS_ACTIONS } from './constants.js';
import { drainInputQueue } from './input.js';

function fmt(n: number): string {
    return n.toLocaleString();
}

/** Render a non-negative duration in seconds as the largest sensible unit. */
function formatDuration(totalSeconds: number): string {
    if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
    const minutes = Math.round(totalSeconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round(totalSeconds / 3600);
    if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(totalSeconds / 86400);
    return `${days} day${days === 1 ? '' : 's'}`;
}

export function setupConnection(ws: WebSocket, ctx: GameContext, onDisconnect: () => void) {
    function refreshMinimap() {
        if (!ctx.minimap) return;
        const vp = ctx.minimap.getViewport();
        ctx.sendMsg({
            type: ClientMsgType.GetNeighborhood,
            halfWidthWorld: vp.halfWidthWorld,
            halfHeightWorld: vp.halfHeightWorld,
            centerXWorld: vp.centerXWorld,
            centerYWorld: vp.centerYWorld,
        });
    }

    ws.addEventListener('open', () => {
        ctx.term.writeln(render(NOTIFY.connected));
    });

    ws.addEventListener('close', () => {
        onDisconnect();
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
        if (raw.menu) {
            ctx.mode = raw.menu as MenuName;
        }
        // No payload ⇔ pure menu transition. The envelope's `menu` field
        // (already mirrored into ctx.mode above) is the entire content;
        // the new menu's enter() — if it has one — paints the prompt.
        if (raw.payload === undefined) {
            getMenuHandler(ctx.mode)?.enter?.(ctx);
            ctx.inFlight = false;
            drainInputQueue(ctx);
            return;
        }
        const msg: ServerResult = raw.payload;
        switch (msg.type) {
            case ServerMsgType.Welcome:
                ctx.playerName = msg.name;
                ctx.playerId = msg.playerId;
                ctx.totalSectors = msg.totalSectors;
                ctx.currentShipName = msg.shipName;
                ctx.currentColoredShipName = msg.coloredShipName;
                ctx.starbaseSector = msg.starbaseSector;
                ctx.isAdmin = msg.isAdmin;
                if (msg.isAdmin) ctx.minimap?.setAdminMode(true);
                ctx.term.writeln(render(NOTIFY.welcome, { name: msg.name }));
                if (msg.isGuest) {
                    ctx.term.writeln(render(NOTIFY.welcomeGuest));
                }
                ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                refreshMinimap();
                break;
            case ServerMsgType.PlayerMoved:
                ctx.term.writeln(
                    render(msg.direction === 'in' ? NOTIFY.playerIn : NOTIFY.playerOut, {
                        name: msg.playerName,
                    }),
                );
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
                refreshMinimap();
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
                        if (msg.shipInfo) {
                            ctx.class0ShipState = {
                                shipName: msg.shipInfo.shipName,
                                credits: msg.credits ?? 0,
                                drones: msg.shipInfo.drones,
                                maxDrones: msg.shipInfo.maxDrones,
                                shields: msg.shipInfo.shields,
                                maxShields: msg.shipInfo.maxShields,
                                holds: msg.shipInfo.holds,
                                maxHolds: msg.shipInfo.maxHolds,
                            };
                        }
                        showClass0Menu(ctx, true);
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
                const tpl =
                    msg.action === 'buy'
                        ? TRANSACTION.tradeConfirmSell
                        : TRANSACTION.tradeConfirmBuy;
                ctx.term.writeln(render(tpl, { total: fmt(msg.totalPrice) }));
                ctx.term.write(render(TRANSACTION.tradeConfirmAccept));
                break;
            }
            case ServerMsgType.TradeComplete:
                ctx.term.writeln(render(TRANSACTION.tradeComplete, { credits: fmt(msg.credits) }));
                break;
            case ServerMsgType.TradeSkipped: {
                const tpl =
                    msg.reason === 'noTrade'
                        ? PORT.noTrade
                        : msg.reason === 'insufficientTurns'
                          ? PORT.skipInsufficientTurns
                          : msg.reason === 'insufficientCredits'
                            ? PORT.skipInsufficientCredits
                            : msg.reason === 'insufficientPortInventory'
                              ? PORT.skipInsufficientPortInventory
                              : msg.reason === 'insufficientCargoHolds'
                                ? PORT.skipInsufficientCargoHolds
                                : msg.reason === 'insufficientCargo'
                                  ? PORT.skipInsufficientCargo
                                  : PORT.skipPortCannotBuy;
                ctx.term.writeln('');
                ctx.term.writeln(render(tpl));
                break;
            }
            case ServerMsgType.UndockResult:
                if (msg.outcome === 'success') {
                    ctx.dockedPortInfo = null;
                    ctx.class0ShipState = null;
                    ctx.sectorPlayers = msg.players;
                    refreshMinimap();
                    showPrompt(ctx);
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
                    ctx.term.writeln(render(TRANSACTION.jettisoned, { items: items || 'nothing' }));
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
                ctx.currentColoredShipName = msg.coloredShipName;
                ctx.term.writeln('');
                ctx.term.writeln(render(SECTOR.playerInfoName, { name: ctx.playerName }));
                ctx.term.writeln(render(SECTOR.playerInfoSector, { sector: ctx.currentSector }));
                ctx.term.writeln(
                    render(PANEL.shipName, { name: msg.coloredShipName ?? msg.shipName }),
                );
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
                if (ctx.hardwareCatalog && ctx.hardwareCatalog.length > 0) {
                    for (const item of ctx.hardwareCatalog) {
                        const max = msg.hardwareMax[item.name];
                        if (max === undefined || max === 0) {
                            // Ship type can't carry this item — skip.
                            continue;
                        }
                        const qty = msg.hardware[item.name] ?? 0;
                        if (item.kind === 'toggle') {
                            ctx.term.writeln(
                                render(
                                    qty > 0
                                        ? PANEL.shipHardwareRowToggleOn
                                        : PANEL.shipHardwareRowToggleOff,
                                    { label: item.label.padEnd(18) },
                                ),
                            );
                        } else {
                            ctx.term.writeln(
                                render(PANEL.shipHardwareRowStackable, {
                                    label: item.label.padEnd(18),
                                    qty,
                                    max,
                                }),
                            );
                        }
                    }
                }
                ctx.term.writeln(
                    render(PANEL.shipCreditsTurns, { credits: msg.credits, turns: msg.turns }),
                );
                ctx.term.writeln(render(PANEL.shipTurnsPerWarp, { turns: msg.turnsPerWarp }));
                if (ctx.mode === Menu.Sector) showPrompt(ctx);
                break;
            case ServerMsgType.PlayersOnlineResult: {
                ctx.term.writeln('');
                ctx.term.writeln(render(PANEL.playersOnlineHeader, { count: msg.players.length }));
                for (const p of msg.players) {
                    const suffix = p.id === ctx.playerId ? render(PANEL.playersOnlineYouTag) : '';
                    ctx.term.writeln(render(PANEL.playersOnlineRow, { name: p.name, suffix }));
                }
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.MoveResult:
                switch (msg.outcome) {
                    case 'success': {
                        ctx.sectorPlayers = msg.players;
                        const inAutopilot = ctx.autopilotPath.length > 0;
                        const moreHops =
                            inAutopilot && ctx.autopilotStep < ctx.autopilotPath.length;
                        // Render sector body. Suppress the command prompt when still
                        // mid-autopilot, or when this is the final hop (so the
                        // "arrived" banner can land between body and prompt).
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
                            !inAutopilot,
                        );
                        refreshMinimap();
                        if (moreHops) {
                            const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                            ctx.autopilotStep = ctx.autopilotStep + 1;
                            ctx.term.writeln(
                                render(EVENT.autopilotWarping, { sector: nextSector }),
                            );
                            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                        } else if (inAutopilot) {
                            ctx.term.writeln(
                                render(EVENT.autopilotArrived, { sector: msg.sector }),
                            );
                            ctx.autopilotPath = [];
                            ctx.autopilotStep = 0;
                            showPrompt(ctx);
                        }
                        break;
                    }
                    case 'encounter': {
                        ctx.sectorPlayers = msg.players;
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
                    showAutopilotPrompt(ctx, msg.path, msg.hops, msg.turns);
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
                if (ctx.class0ShipState) {
                    ctx.class0ShipState.credits = msg.credits;
                    ctx.class0ShipState.drones = msg.drones;
                }
                if (ctx.dockedPortInfo?.class === 0 || ctx.class0ShipState) {
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.BuyShieldsResult:
                ctx.term.writeln(render(TRANSACTION.purchaseComplete));
                ctx.term.writeln(
                    render(TRANSACTION.purchaseStatsShields, {
                        credits: msg.credits,
                        shields: msg.shields,
                    }),
                );
                if (ctx.class0ShipState) {
                    ctx.class0ShipState.credits = msg.credits;
                    ctx.class0ShipState.shields = msg.shields;
                }
                if (ctx.dockedPortInfo?.class === 0 || ctx.class0ShipState) {
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.BuyHoldsResult:
                ctx.term.writeln(render(TRANSACTION.purchaseComplete));
                ctx.term.writeln(
                    render(TRANSACTION.purchaseStatsHolds, {
                        credits: msg.credits,
                        holds: msg.cargoLimit,
                    }),
                );
                if (ctx.class0ShipState) {
                    ctx.class0ShipState.credits = msg.credits;
                    ctx.class0ShipState.holds = msg.cargoLimit;
                }
                if (ctx.dockedPortInfo?.class === 0 || ctx.class0ShipState) {
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.AttackShipResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(msg.destroyed ? EVENT.attackDestroyed : EVENT.attackCompleted, {
                        message:
                            msg.message ||
                            (msg.destroyed ? 'Target destroyed!' : 'Attack completed.'),
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
            case ServerMsgType.BuyShipNewResult: {
                ctx.currentShipName = msg.shipName;
                ctx.currentColoredShipName = msg.coloredShipName;
                const tpl =
                    msg.type === ServerMsgType.BuyShipTradeinResult
                        ? TRANSACTION.shipExchanged
                        : TRANSACTION.shipPurchased;
                ctx.term.writeln(render(tpl, { name: msg.coloredShipName ?? msg.shipName }));
                ctx.term.writeln(
                    render(TRANSACTION.shipCreditsLine, { credits: fmt(msg.credits) }),
                );
                // Refresh class0ShipState so the next commerce report reflects
                // the new ship's max stats. The new ship starts empty (drones=0,
                // shields=0); current cargoLimit comes from the result, and
                // maxHolds comes from the catalog (server doesn't include it).
                if (ctx.class0ShipState) {
                    const cfg = ctx.shipConfigs?.find((s) => s.name === msg.shipName);
                    ctx.class0ShipState = {
                        shipName: msg.shipName,
                        credits: msg.credits,
                        drones: 0,
                        maxDrones: msg.maxDrones,
                        shields: 0,
                        maxShields: msg.maxShields,
                        holds: msg.cargoLimit,
                        maxHolds: cfg?.max_holds ?? msg.cargoLimit,
                    };
                }
                showShipyardsMenu(ctx);
                break;
            }
            case ServerMsgType.PlanetInfoResult:
                if (msg.hasPlanet) showPlanetMenu(ctx, msg.name, msg.colonists);
                else showNoPlanet(ctx);
                break;
            case ServerMsgType.TakeColonistsResult: {
                ctx.shipColonists = msg.shipColonists;
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
                ctx.term.writeln(render(PANEL.shipColonistsLine, { count: msg.shipColonists }));
                break;
            }
            case ServerMsgType.LeaveColonistsResult: {
                ctx.shipColonists = msg.shipColonists;
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
                ctx.term.writeln(render(PANEL.shipColonistsLine, { count: msg.shipColonists }));
                if (ctx.mode === Menu.PlanetEarth) {
                    showEarthMenu(ctx, msg.planetColonists);
                } else if (ctx.mode === Menu.Planet) {
                    showPlanetMenuOptions(ctx);
                }
                break;
            }
            case ServerMsgType.DroneEncounter: {
                ctx.sectorPlayers = msg.players;
                ctx.encounterOwnerName = msg.ownerName;
                showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
                refreshMinimap();
                if (ctx.autopilotPath.length > 0) {
                    ctx.autopilotPaused = true;
                    ctx.term.writeln(render(EVENT.autopilotDisengaged));
                }
                showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
                break;
            }
            case ServerMsgType.DeployDronesInfoResult: {
                const total = msg.shipDrones + msg.sectorDrones;
                const minInSector = Math.max(0, total - msg.shipMaxDrones);
                ctx.term.writeln('');
                ctx.term.writeln(
                    render(EVENT.deployDronesInfo, {
                        total,
                        max: msg.shipMaxDrones,
                        minInSector,
                    }),
                );
                ctx.term.write(render(EVENT.deployDronesPrompt, { minInSector }));
                break;
            }
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
                if (msg.shipInfo) {
                    ctx.class0ShipState = {
                        shipName: msg.shipInfo.shipName,
                        credits: msg.credits ?? 0,
                        drones: msg.shipInfo.drones,
                        maxDrones: msg.shipInfo.maxDrones,
                        shields: msg.shipInfo.shields,
                        maxShields: msg.shipInfo.maxShields,
                        holds: msg.shipInfo.holds,
                        maxHolds: msg.shipInfo.maxHolds,
                    };
                }
                showStarbaseMenu(ctx);
                break;
            case ServerMsgType.LeaveStarbaseResult:
                ctx.class0ShipState = null;
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
                refreshMinimap();
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
                ctx.planetEmptyHolds = msg.empty_holds;
                ctx.shipColonists = msg.ship_colonists;
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
                ctx.planetEmptyHolds = msg.empty_holds;
                ctx.shipColonists = msg.ship_colonists;
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
                showPlanetMenuOptions(ctx);
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
                // Refresh store state from the server (credits + ship qtys changed).
                ctx.sendMsg({ type: ClientMsgType.HardwareStoreInfo });
                break;
            case ServerMsgType.ListDeployedDronesResult:
                ctx.term.writeln('');
                if (msg.drones.length === 0) {
                    ctx.term.writeln(render(PANEL.deployedDronesEmpty));
                } else {
                    ctx.term.writeln(render(PANEL.deployedDronesHeader));
                    for (const d of msg.drones) {
                        ctx.term.writeln(
                            render(PANEL.deployedDronesRow, {
                                sector: d.sectorId,
                                qty: d.quantity,
                            }),
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
                refreshMinimap();
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
            case ServerMsgType.AttackMenuResult:
                ctx.sectorPlayers = msg.players;
                showAttackMenu(ctx);
                break;
            case ServerMsgType.HardwareStoreInfoResult:
                ctx.hardwareStoreCredits = msg.credits;
                ctx.hardwareStoreItems = msg.items;
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.TerraformInfoResult:
                if (msg.canTerraform) {
                    ctx.term.writeln(
                        render(NOTIFY.terraformDevicesAvailable, { count: msg.devices }),
                    );
                    ctx.term.write(render(NOTIFY.terraformConfirm));
                } else if (msg.reason === 'no_devices') {
                    ctx.term.writeln(render(NOTIFY.terraformNoDevices));
                    showPrompt(ctx);
                } else {
                    ctx.term.writeln(render(NOTIFY.error, { message: 'Cannot terraform here.' }));
                    showPrompt(ctx);
                }
                break;
            case ServerMsgType.StarbaseInfoResult: {
                ctx.starbaseSector = msg.sector;
                if (msg.sector != null) {
                    ctx.term.writeln(render(NOTIFY.starbaseLocation, { sector: msg.sector }));
                } else {
                    ctx.term.writeln(render(NOTIFY.noStarbase));
                }
                ctx.term.writeln(render(NOTIFY.universeStatsHeader, { name: msg.universeName }));
                const createdDate = (() => {
                    try {
                        return new Date(msg.createdAt).toLocaleString();
                    } catch {
                        return msg.createdAt;
                    }
                })();
                ctx.term.writeln(
                    render(NOTIFY.universeStatsCreated, {
                        date: createdDate,
                        days: msg.daysElapsed,
                    }),
                );
                ctx.term.writeln(
                    render(NOTIFY.universeStatsLine, {
                        label: 'Sectors           ',
                        value: fmt(msg.sectorCount),
                    }),
                );
                ctx.term.writeln(
                    render(NOTIFY.universeStatsLine, {
                        label: 'Ports at creation ',
                        value: fmt(msg.portCount),
                    }),
                );
                ctx.term.writeln(
                    render(NOTIFY.universeStatsLine, {
                        label: 'Max planets/sector',
                        value: fmt(msg.maxPlanetsPerSector),
                    }),
                );
                ctx.term.writeln(
                    render(NOTIFY.universeStatsLine, {
                        label: 'Starting credits  ',
                        value: fmt(msg.startingCredits),
                    }),
                );
                ctx.term.writeln(
                    render(NOTIFY.universeStatsLine, {
                        label: 'Starting turns    ',
                        value: fmt(msg.startingTurns),
                    }),
                );
                ctx.term.writeln(
                    render(NOTIFY.universeStatsLine, {
                        label: 'Starting drones   ',
                        value: fmt(msg.startingDrones),
                    }),
                );
                ctx.term.writeln(
                    render(NOTIFY.universeStatsLine, {
                        label: 'Starting holds    ',
                        value: fmt(msg.startingHolds),
                    }),
                );
                if (msg.respawnDelaySeconds <= 0) {
                    ctx.term.writeln(render(NOTIFY.universeStatsRespawnNone));
                } else {
                    ctx.term.writeln(
                        render(NOTIFY.universeStatsRespawnSeconds, {
                            value: formatDuration(msg.respawnDelaySeconds),
                        }),
                    );
                }
                ctx.term.writeln(render(NOTIFY.universeStatsDegHeader));
                for (let deg = 1; deg <= 6; deg++) {
                    const count = msg.outWarpDistribution[deg] ?? 0;
                    if (count === 0) continue;
                    ctx.term.writeln(
                        render(NOTIFY.universeStatsDegRow, {
                            degree: deg,
                            s: deg === 1 ? '' : 's',
                            count: fmt(count),
                            ss: count === 1 ? '' : 's',
                        }),
                    );
                }
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.PreviousSectorResult:
                if (msg.sector === null) {
                    ctx.term.writeln(render(NOTIFY.noPreviousSector));
                    showPrompt(ctx);
                } else {
                    ctx.sendMsg({ type: ClientMsgType.Move, sector: msg.sector });
                }
                break;
            case ServerMsgType.NeighborhoodResult:
                ctx.minimap?.update(msg, ctx.currentSector);
                break;
            case ServerMsgType.Error:
                ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
                if (ctx.mode === Menu.TradeQty || ctx.mode === Menu.TradeConfirm) {
                    ctx.sendMsg({ type: ClientMsgType.Undock });
                } else if (ctx.mode === Menu.DeployDronesQty) {
                    showPrompt(ctx);
                } else if (ctx.mode === Menu.DroneEncounter || ctx.mode === Menu.DroneAttackQty) {
                    // stay in encounter mode
                } else if (ctx.mode === Menu.ShipyardsClass0Qty) {
                    // Failed buy from the shipyards Class-0 menu — drop back
                    // to that Class-0 menu (not all the way to Shipyards) so
                    // the user can pick a different item.
                    ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.ShipyardsClass0 });
                    showClass0Menu(ctx);
                } else if (ctx.mode === Menu.Class0Qty) {
                    ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Class0 });
                    showClass0Menu(ctx);
                } else if (ctx.mode.startsWith(Menu.Shipyards)) {
                    showShipyardsMenu(ctx);
                } else if (ctx.mode === Menu.StarbaseHardware) {
                    showHardwareMenu(ctx);
                } else if (ctx.mode === Menu.Sector) showPrompt(ctx);
                break;
        }
        // After every server message: clear in-flight and drain the burst/script
        // queue. Direct user keystrokes don't go through the queue, so this only
        // affects programmatic input sources.
        ctx.inFlight = false;
        drainInputQueue(ctx);
    });
    ws.addEventListener('error', () => {
        ctx.term.writeln(render(NOTIFY.connectionError));
    });
}
