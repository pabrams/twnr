import { ServerMsgType, ClientMsgType } from '@twnr/shared';
import type { ServerMessage } from '@twnr/shared';
import type { GameContext } from './display.js';
import { showSectorDisplay, showDockedMenu, showPrompt } from './display.js';
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
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.visitedSectors,
                );
                break;
            case ServerMsgType.DockResult:
                if (msg.docked && msg.port) {
                    ctx.setDockedPortInfo(msg.port);
                    ctx.setMode('docked');
                    showDockedMenu(ctx);
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
                    `  Cargo — ${colors.boldYellow('Fuel')}: ${msg.cargo.fuel}, ${colors.boldYellow('Organics')}: ${msg.cargo.organics}, ${colors.boldYellow('Equipment')}: ${msg.cargo.equipment}`,
                );
                if (ctx.mode === 'docked') showDockedMenu(ctx);
                break;
            case ServerMsgType.ShipInfo:
                ctx.term.writeln('');
                ctx.term.writeln(`${colors.white('Ship:')} ${colors.boldCyan(msg.shipName)}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Fighters')}: ${colors.white(`${msg.fighters}`)}/${colors.cyan(`${msg.maxFighters}`)}  ${colors.boldYellow('Shields')}: ${colors.white(`${msg.shields}`)}/${colors.cyan(`${msg.maxShields}`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Cargo holds')}: ${colors.boldGreen(`${msg.holdsAvailable} free`)} / ${colors.white(`${msg.cargoLimit} total`)} ${mg('(')}max ${msg.maxHolds}${mg(')')}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Fuel')}: ${msg.cargoFuel}  ${colors.boldYellow('Organics')}: ${msg.cargoOrganics}  ${colors.boldYellow('Equipment')}: ${msg.cargoEquipment}`,
                );
                break;
            case ServerMsgType.CargoInfo:
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${colors.boldYellow(String(msg.credits))}`,
                );
                if (ctx.mode === 'shipInfo') {
                    ctx.setMode('sector');
                    ctx.term.writeln('');
                    ctx.term.writeln(`Press ${colors.boldYellow("'q'")} to return.`);
                }
                break;
            case ServerMsgType.NonAdjacentMoveRequested:
                ctx.term.writeln(
                    `\r\n${colors.boldRed(`Cannot move to sector ${msg.sector} — not adjacent.`)}`,
                );
                showPrompt(ctx);
                break;
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
