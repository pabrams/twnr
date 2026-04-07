import { ServerMsgType, ClientMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';
import type { GameContext } from './types.js';
import { colorSector } from './types.js';
import { showSectorDisplay, showDockedMenu, showPrompt } from './display.js';
import { showClass0Menu, showAutopilotPrompt } from './display-port.js';
import { showPlanetMenu, showNoPlanet } from './display-planet.js';
import { showFighterEncounter } from './display-combat.js';
import { colors, MenuMode } from './constants.js';

const mg = colors.magenta;

export function setupConnection(ws: WebSocket, ctx: GameContext) {
    ws.addEventListener('open', () => {
        ctx.term.writeln(colors.green('Connected to TWNR.'));
    });

    ws.addEventListener('message', (event) => {
        const msg: ServerResult = JSON.parse(event.data);
        switch (msg.type) {
            case ServerMsgType.Welcome:
                ctx.setPlayerName(msg.name);
                ctx.setPlayerId(msg.playerId);
                ctx.setTotalSectors(msg.totalSectors);
                ctx.term.writeln(`\r\n${colors.boldGreen(`Welcome, ${msg.name}.`)}`);
                ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case ServerMsgType.PlayerMoved:
                if (msg.direction === 'in') {
                    ctx.term.writeln(`\r\n${colors.boldYellow('Player warped into the sector.')}`);
                } else {
                    ctx.term.writeln(`\r\n${colors.white('Player warped out of the sector.')}`);
                }
                break;
            case ServerMsgType.SectorDisplayResult:
                ctx.setSectorPlayers(msg.players);
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.visitedSectors,
                    msg.sectorFighters,
                );
                // Advance autopilot if in progress
                if (
                    ctx.mode === MenuMode.Autopilot &&
                    ctx.autopilotStep < ctx.autopilotPath.length
                ) {
                    const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                    ctx.setAutopilotStep(ctx.autopilotStep + 1);
                    ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                } else if (ctx.mode === MenuMode.Autopilot) {
                    // Arrived at destination
                    ctx.setMode(MenuMode.Sector);
                }
                break;
            case ServerMsgType.DockResult:
                if (msg.docked && msg.port) {
                    ctx.setDockedPortInfo(msg.port);
                    if (msg.port.class === 0) {
                        ctx.setMode(MenuMode.Class0);
                        showClass0Menu(ctx);
                    } else {
                        ctx.setMode(MenuMode.Docked);
                        showDockedMenu(ctx);
                    }
                }
                break;
            case ServerMsgType.UndockResult:
                if (msg.outcome === 'success') {
                    ctx.setDockedPortInfo(null);
                    ctx.setMode(MenuMode.Sector);
                    ctx.term.writeln(`\r\n${colors.white('You undock from the port.')}`);
                    ctx.setSectorPlayers(msg.players);
                    showSectorDisplay(
                        ctx,
                        msg.sector,
                        msg.warps,
                        msg.players,
                        msg.port,
                        msg.visitedSectors,
                        msg.sectorFighters,
                    );
                } else {
                    ctx.term.writeln(`\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`);
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
                        `\r\n${colors.boldYellow('Jettisoned:')} ${items || 'nothing'}`,
                    );
                } else {
                    ctx.term.writeln(`\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`);
                }
                ctx.setMode(MenuMode.Sector);
                showPrompt(ctx);
                break;
            case ServerMsgType.PortTransactionResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Transaction complete.')} Credits: ${colors.boldYellow(String(msg.credits))}`,
                );
                ctx.term.writeln(
                    `  Cargo — ${colors.boldYellow('Fuel')}: ${msg.cargo.fuel}, ${colors.boldYellow('Organics')}: ${msg.cargo.organics}, ${colors.boldYellow('Equipment')}: ${msg.cargo.equipment}, ${colors.boldYellow('Colonists')}: ${msg.cargo.colonists}`,
                );
                if (ctx.mode === MenuMode.Docked) showDockedMenu(ctx);
                break;
            case ServerMsgType.ShipInfoResult:
                ctx.setCurrentShipName(msg.shipName);
                ctx.term.writeln('');
                ctx.term.writeln(`${colors.white('Ship:')} ${colors.boldCyan(msg.shipName)}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Fighters')}: ${colors.white(`${msg.fighters}`)}/${colors.cyan(`${msg.maxFighters}`)}  ${colors.boldYellow('Shields')}: ${colors.white(`${msg.shields}`)}/${colors.cyan(`${msg.maxShields}`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Cargo holds')}: ${colors.boldGreen(`${msg.holdsAvailable} free`)} / ${colors.white(`${msg.cargoLimit} total`)} ${mg('(')}max ${msg.maxHolds}${mg(')')}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Fuel')}: ${msg.cargoFuel}  ${colors.boldYellow('Organics')}: ${msg.cargoOrganics}  ${colors.boldYellow('Equipment')}: ${msg.cargoEquipment}  ${colors.boldYellow('Colonists')}: ${msg.cargoColonists}`,
                );
                break;
            case ServerMsgType.CargoInfoResult:
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${colors.boldYellow(String(msg.credits))}`,
                );
                if (ctx.mode === MenuMode.ShipInfo || ctx.mode === MenuMode.PlayerInfo) {
                    ctx.term.writeln('');
                    ctx.term.writeln(`Press ${colors.boldYellow("'q'")} to return.`);
                }
                break;
            case ServerMsgType.PlayersOnlineResult: {
                ctx.term.writeln('');
                ctx.term.writeln(`${colors.boldCyan('Players Online')} (${msg.players.length}):`);
                for (const p of msg.players) {
                    const tag = p.id === ctx.playerId ? colors.boldGreen(' (you)') : '';
                    ctx.term.writeln(
                        `  ${colors.boldYellow(p.name)} in sector ${colorSector(p.sector, ctx.visitedSet)}${tag}`,
                    );
                }
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.MoveResult:
                switch (msg.outcome) {
                    case 'success':
                        ctx.setSectorPlayers(msg.players);
                        showSectorDisplay(
                            ctx,
                            msg.sector,
                            msg.warps,
                            msg.players,
                            msg.port,
                            msg.visitedSectors,
                            msg.sectorFighters,
                        );
                        if (
                            ctx.mode === MenuMode.Autopilot &&
                            ctx.autopilotStep < ctx.autopilotPath.length
                        ) {
                            const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                            ctx.setAutopilotStep(ctx.autopilotStep + 1);
                            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                        } else if (ctx.mode === MenuMode.Autopilot) {
                            ctx.setMode(MenuMode.Sector);
                        }
                        break;
                    case 'encounter': {
                        ctx.setSectorPlayers(msg.players);
                        if (msg.visitedSectors) ctx.setVisitedSet(new Set(msg.visitedSectors));
                        ctx.setCurrentSector(msg.sector);
                        ctx.setCurrentPort(msg.port ?? null);
                        ctx.setEncounterOwnerName(msg.ownerName);
                        showSectorDisplay(
                            ctx,
                            msg.sector,
                            msg.warps,
                            msg.players,
                            msg.port,
                            msg.visitedSectors,
                        );
                        if (ctx.mode === MenuMode.Autopilot) {
                            ctx.setAutopilotPaused(true);
                            ctx.term.writeln(
                                `\r\n${colors.boldRed('Autopilot disengaged — hostile fighters!')}`,
                            );
                        }
                        showFighterEncounter(
                            ctx,
                            msg.sectorFighters,
                            msg.ownerName,
                            msg.shipFighters,
                        );
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
                        ctx.term.writeln(`\r\n${colors.boldRed('You do not have a ship.')}`);
                        showPrompt(ctx);
                        break;
                    case 'error':
                        ctx.term.writeln(
                            `\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`,
                        );
                        showPrompt(ctx);
                        break;
                }
                break;
            case ServerMsgType.NonAdjacentMoveRequested:
                // Legacy — kept for backwards compatibility during refactor
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
                    ctx.term.writeln(`\r\n${colors.boldRed('No path found to that sector.')}`);
                    showPrompt(ctx);
                }
                break;
            case ServerMsgType.BuyFightersResult:
                ctx.term.writeln(`\r\n${colors.boldGreen('Purchase complete.')}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${msg.credits}  ${colors.boldYellow('Fighters')}: ${msg.fighters}`,
                );
                if (ctx.mode === MenuMode.Class0Qty) {
                    ctx.setMode(MenuMode.Class0);
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.BuyShieldsResult:
                ctx.term.writeln(`\r\n${colors.boldGreen('Purchase complete.')}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${msg.credits}  ${colors.boldYellow('Shields')}: ${msg.shields}`,
                );
                if (ctx.mode === MenuMode.Class0Qty) {
                    ctx.setMode(MenuMode.Class0);
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.BuyHoldsResult:
                ctx.term.writeln(`\r\n${colors.boldGreen('Purchase complete.')}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${msg.credits}  ${colors.boldYellow('Holds')}: ${msg.cargoLimit}`,
                );
                if (ctx.mode === MenuMode.Class0Qty) {
                    ctx.setMode(MenuMode.Class0);
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.AttackShipResult:
                ctx.term.writeln('');
                if (msg.destroyed) {
                    ctx.term.writeln(colors.boldRed(msg.message || 'Target destroyed!'));
                } else {
                    ctx.term.writeln(colors.boldYellow(msg.message || 'Attack completed.'));
                }
                ctx.term.writeln(
                    `  ${colors.boldYellow('Your fighters lost')}: ${msg.attackerFightersLost}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Defender shields lost')}: ${msg.defenderShieldsLost}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Defender fighters lost')}: ${msg.defenderFightersLost}`,
                );
                ctx.setMode(MenuMode.Sector);
                showPrompt(ctx);
                break;
            case ServerMsgType.BuyShipTradeinResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Ship exchanged!')} Now flying: ${colors.boldCyan(msg.shipName)}`,
                );
                ctx.term.writeln(`  ${colors.boldYellow('Credits')}: ${msg.credits}`);
                if (ctx.mode === MenuMode.Docked) showDockedMenu(ctx);
                break;
            case ServerMsgType.PlanetInfoResult:
                if (msg.hasPlanet) {
                    showPlanetMenu(ctx, msg.name, msg.colonists);
                } else {
                    showNoPlanet(ctx);
                }
                break;
            case ServerMsgType.TakeColonistsResult: {
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldGreen(`You took ${msg.quantity.toLocaleString()} colonists.`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Planet colonists')}: ${colors.white(msg.planetColonists.toLocaleString())}`,
                );
                ctx.term.writeln(
                    `\r\n${colors.white('You return to your ship and leave the planet.')}`,
                );
                ctx.setMode(MenuMode.Sector);
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.LeaveColonistsResult: {
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldGreen(`You left ${msg.quantity.toLocaleString()} colonists.`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Planet colonists')}: ${colors.white(msg.planetColonists.toLocaleString())}`,
                );
                ctx.term.writeln(
                    `\r\n${colors.white('You return to your ship and leave the planet.')}`,
                );
                ctx.setMode(MenuMode.Sector);
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.FighterEncounter: {
                ctx.setSectorPlayers(msg.players);
                if (msg.visitedSectors) ctx.setVisitedSet(new Set(msg.visitedSectors));
                ctx.setCurrentSector(msg.sector);
                ctx.setCurrentPort(msg.port ?? null);
                ctx.setEncounterOwnerName(msg.ownerName);

                // Show sector info first
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.visitedSectors,
                );

                if (ctx.mode === MenuMode.Autopilot) {
                    ctx.setAutopilotPaused(true);
                    ctx.term.writeln(
                        `\r\n${colors.boldRed('Autopilot disengaged — hostile fighters!')}`,
                    );
                }

                showFighterEncounter(ctx, msg.sectorFighters, msg.ownerName, msg.shipFighters);
                break;
            }
            case ServerMsgType.DeployFightersInfoResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldYellow('Deploy Fighters')} — Sector: ${colors.white(String(msg.sectorFighters))}, Ship: ${colors.white(String(msg.shipFighters))}/${colors.cyan(String(msg.shipMaxFighters))}`,
                );
                ctx.term.write(
                    `${colors.cyan('How many fighters to leave in sector?')} ${colors.white('(Q to cancel)')} `,
                );
                ctx.setMode(MenuMode.DeployFightersQty);
                break;
            case ServerMsgType.DeployFightersResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Deployed.')} Sector: ${colors.white(String(msg.sectorFighters))}, Ship: ${colors.white(String(msg.shipFighters))}`,
                );
                ctx.setMode(MenuMode.Sector);
                showPrompt(ctx);
                break;
            case ServerMsgType.AttackSectorFightersResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldYellow('Combat:')} Lost ${colors.boldRed(String(msg.fightersLost))} fighters. Sector fighters remaining: ${colors.boldRed(String(msg.sectorFightersRemaining))}. Ship fighters: ${colors.white(String(msg.shipFighters))}`,
                );
                if (msg.victory) {
                    ctx.term.writeln(colors.boldGreen('Sector cleared!'));
                    if (ctx.autopilotPaused) {
                        ctx.term.writeln(colors.boldCyan('Autopilot resuming...'));
                        ctx.setMode(MenuMode.Autopilot);
                        ctx.setAutopilotPaused(false);
                        // Server will send SectorDisplay which triggers autopilot advance
                        ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                    } else {
                        ctx.setMode(MenuMode.Sector);
                        showPrompt(ctx);
                    }
                } else {
                    // Re-show encounter with updated numbers
                    showFighterEncounter(
                        ctx,
                        msg.sectorFightersRemaining,
                        ctx.encounterOwnerName,
                        msg.shipFighters,
                    );
                }
                break;
            case ServerMsgType.RetreatFromFightersResult:
                ctx.term.writeln(
                    `\r\n${colors.boldYellow('Retreated to sector')} ${colors.boldCyan(String(msg.sector))}`,
                );
                if (ctx.autopilotPaused) {
                    ctx.setAutopilotPath([]);
                    ctx.setAutopilotStep(0);
                    ctx.setAutopilotPaused(false);
                    ctx.term.writeln(colors.boldRed('Autopilot cancelled.'));
                }
                ctx.setMode(MenuMode.Sector);
                // SectorDisplay follows from server
                break;
            case ServerMsgType.SectorFightersAlert:
                ctx.term.writeln('');
                if (msg.event === 'intrusion') {
                    ctx.term.writeln(
                        `${colors.boldYellow('Alert:')} ${colors.boldRed(msg.intruderName)} entered sector ${colors.boldCyan(String(msg.sector))} with your fighters!`,
                    );
                } else if (msg.event === 'attacked') {
                    ctx.term.writeln(
                        `${colors.boldRed('Alert:')} ${colors.boldRed(msg.intruderName)} attacked your fighters in sector ${colors.boldCyan(String(msg.sector))}! Lost: ${msg.fightersLost}, remaining: ${msg.fightersRemaining}`,
                    );
                } else if (msg.event === 'destroyed') {
                    ctx.term.writeln(
                        `${colors.boldRed('Alert:')} ${colors.boldRed(msg.intruderName)} destroyed all your fighters in sector ${colors.boldCyan(String(msg.sector))}!`,
                    );
                }
                break;
            case ServerMsgType.Error:
                ctx.term.writeln(`\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`);
                if (ctx.mode === MenuMode.Docked) showDockedMenu(ctx);
                else if (ctx.mode === MenuMode.DeployFightersQty) {
                    ctx.setMode(MenuMode.Sector);
                    showPrompt(ctx);
                } else if (
                    ctx.mode === MenuMode.FighterEncounter ||
                    ctx.mode === MenuMode.FighterAttackQty
                ) {
                    // Stay in encounter mode — re-prompt
                } else if (ctx.mode === MenuMode.Sector) showPrompt(ctx);
                break;
        }
    });
    ws.addEventListener('error', () => {
        ctx.term.writeln(`\r\n${colors.boldRed('Connection error.')}`);
    });
}
