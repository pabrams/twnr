import { ServerMsgType, ClientMsgType } from '@twnr/shared';
import type { ServerMessage } from '@twnr/shared';
import type { GameContext } from './display.js';
import {
    showSectorDisplay,
    showDockedMenu,
    showPrompt,
    showClass0Menu,
    showAutopilotPrompt,
    colorSector,
    showPlanetMenu,
    showNoPlanet,
} from './display.js';
import { colors } from './constants.js';

const mg = colors.magenta;

export function setupConnection(ws: WebSocket, ctx: GameContext) {
    ws.addEventListener('open', () => {
        ctx.term.writeln(colors.green('Connected to TWNR.'));
    });

    ws.addEventListener('message', (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
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
            case ServerMsgType.SectorDisplay:
                ctx.setSectorPlayers(msg.players);
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.visitedSectors,
                );
                // Advance autopilot if in progress
                if (ctx.mode === 'autopilot' && ctx.autopilotStep < ctx.autopilotPath.length) {
                    const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                    ctx.setAutopilotStep(ctx.autopilotStep + 1);
                    ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                } else if (ctx.mode === 'autopilot') {
                    // Arrived at destination
                    ctx.setMode('sector');
                }
                break;
            case ServerMsgType.DockResult:
                if (msg.docked && msg.port) {
                    ctx.setDockedPortInfo(msg.port);
                    if (msg.port.class === 0) {
                        ctx.setMode('class0');
                        showClass0Menu(ctx);
                    } else {
                        ctx.setMode('docked');
                        showDockedMenu(ctx);
                    }
                } else {
                    ctx.setDockedPortInfo(null);
                    ctx.setMode('sector');
                    ctx.term.writeln(`\r\n${colors.white('You undock from the port.')}`);
                    ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                }
                break;
            case ServerMsgType.PortTransactionResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Transaction complete.')} Credits: ${colors.boldYellow(String(msg.credits))}`,
                );
                ctx.term.writeln(
                    `  Cargo — ${colors.boldYellow('Fuel')}: ${msg.cargo.fuel}, ${colors.boldYellow('Organics')}: ${msg.cargo.organics}, ${colors.boldYellow('Equipment')}: ${msg.cargo.equipment}, ${colors.boldYellow('Colonists')}: ${msg.cargo.colonists}`,
                );
                if (ctx.mode === 'docked') showDockedMenu(ctx);
                break;
            case ServerMsgType.ShipInfo:
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
            case ServerMsgType.CargoInfo:
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${colors.boldYellow(String(msg.credits))}`,
                );
                if (ctx.mode === 'shipInfo' || ctx.mode === 'playerInfo') {
                    ctx.term.writeln('');
                    ctx.term.writeln(`Press ${colors.boldYellow("'q'")} to return.`);
                }
                break;
            case ServerMsgType.PlayersOnline: {
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
            case ServerMsgType.NonAdjacentMoveRequested:
                // Request shortest path from server for express warp
                ctx.sendMsg({
                    type: ClientMsgType.Path,
                    from: ctx.currentSector,
                    to: msg.sector,
                });
                break;
            case ServerMsgType.PathResult:
                if (msg.path.length > 1) {
                    showAutopilotPrompt(ctx, msg.path, msg.hops);
                } else {
                    ctx.term.writeln(`\r\n${colors.boldRed('No path found to that sector.')}`);
                    showPrompt(ctx);
                }
                break;
            case ServerMsgType.BuyResult:
                ctx.term.writeln(`\r\n${colors.boldGreen('Purchase complete.')}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${msg.credits}  ${colors.boldYellow('Fighters')}: ${msg.fighters}  ${colors.boldYellow('Shields')}: ${msg.shields}  ${colors.boldYellow('Holds')}: ${msg.cargoLimit}`,
                );
                if (ctx.mode === 'class0Qty') {
                    ctx.setMode('class0');
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.AttackResult:
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
                ctx.setMode('sector');
                showPrompt(ctx);
                break;
            case ServerMsgType.ShipExchangeResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Ship exchanged!')} Now flying: ${colors.boldCyan(msg.shipName)}`,
                );
                ctx.term.writeln(`  ${colors.boldYellow('Credits')}: ${msg.credits}`);
                if (ctx.mode === 'docked') showDockedMenu(ctx);
                break;
            case ServerMsgType.PlanetInfo:
                if (msg.hasPlanet) {
                    showPlanetMenu(ctx, msg.name, msg.colonists);
                } else {
                    showNoPlanet(ctx);
                }
                break;
            case ServerMsgType.ColonistResult: {
                const verb = msg.action === 'take' ? 'took' : 'left';
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldGreen(`You ${verb} ${msg.quantity.toLocaleString()} colonists.`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Planet colonists')}: ${colors.white(msg.planetColonists.toLocaleString())}`,
                );
                ctx.term.writeln(
                    `\r\n${colors.white('You return to your ship and leave the planet.')}`,
                );
                ctx.setMode('sector');
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.Error:
                ctx.term.writeln(`\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`);
                if (ctx.mode === 'docked') showDockedMenu(ctx);
                else if (ctx.mode === 'sector') showPrompt(ctx);
                break;
        }
    });

    ws.addEventListener('close', () => {
        ctx.term.writeln(`\r\n${colors.boldRed('Disconnected.')}`);
    });

    ws.addEventListener('error', () => {
        ctx.term.writeln(`\r\n${colors.boldRed('Connection error.')}`);
    });
}
