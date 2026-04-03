import type { Terminal } from '@xterm/xterm';
import type { ClientMessage, PortInfoMessage } from '@twnr/shared';
import { ClientMsgType } from '@twnr/shared';
import { colors, PORT_CLASS_LABELS, PORT_CLASS_ACTIONS, type MenuMode } from './constants.js';

export interface GameContext {
    term: Terminal;
    currentSector: number;
    currentPort: { class: number; name: string } | null;
    dockedPortInfo: PortInfoMessage | null;
    mode: MenuMode;
    visitedSet: Set<number>;
    sendMsg: (msg: ClientMessage) => void;
    setMode: (mode: MenuMode) => void;
    setCurrentSector: (sector: number) => void;
    setCurrentPort: (port: { class: number; name: string } | null) => void;
    setVisitedSet: (set: Set<number>) => void;
    setDockedPortInfo: (p: PortInfoMessage | null) => void;
}

const mg = colors.magenta;

export function showSectorDisplay(
    ctx: GameContext,
    sector: number,
    warps: number[],
    players: { id: number; name: string }[],
    port?: { class: number; name: string } | null,
    visitedSectors?: number[],
) {
    if (visitedSectors) {
        ctx.setVisitedSet(new Set(visitedSectors));
    }
    ctx.setCurrentSector(sector);
    ctx.setCurrentPort(port ?? null);
    ctx.term.writeln('');
    const cl = colors.boldYellow(':');
    ctx.term.writeln(`${colors.boldGreen('Sector')}  ${cl} ${colors.boldCyan(String(sector))}`);
    if (port) {
        const label = PORT_CLASS_LABELS[port.class] ?? '???';
        const coloredLabel =
            label === 'Special'
                ? colors.boldCyan(label)
                : label
                      .split('')
                      .map((ch) => (ch === 'B' ? colors.green(ch) : colors.boldCyan(ch)))
                      .join('');
        ctx.term.writeln(
            `${mg('Port')}    ${cl} ${colors.boldCyan(port.name)}${colors.boldYellow(',')} ${mg('Class')} ${colors.boldCyan(String(port.class))} ${mg('(')}${coloredLabel}${mg(')')}`,
        );
    }
    if (warps.length > 0) {
        ctx.term.writeln(
            `${colors.boldGreen('Warps')}   ${cl} ${warps
                .map((w) => {
                    const num = String(w);
                    if (ctx.visitedSet.has(w)) return colors.boldCyan(num);
                    return `${mg('(')}${colors.boldRed(num)}${mg(')')}`;
                })
                .join(` ${colors.green('-')} `)}`,
        );
    }
    if (players.length > 0) {
        ctx.term.writeln(
            `${mg('Players')} ${cl} ${players.map((p) => colors.boldYellow(p.name)).join(colors.boldYellow(', '))}`,
        );
    }
    showPrompt(ctx);
}

export function showPrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('Command')} ${mg('[')}${colors.boldCyan(String(ctx.currentSector))}${mg(']')} ${mg('(')}${colors.boldYellow('?')}=${colors.boldYellow('Help')}${mg(')')} ${colors.boldYellow(':')} `,
    );
}

export function showHelp(ctx: GameContext) {
    ctx.setMode('help');
    ctx.term.writeln('');
    ctx.term.writeln(colors.cyan('Help Menu:'));
    ctx.term.writeln(`${colors.cyan('Command:')} Move to a sector by typing its number.`);
    ctx.term.writeln(
        `${colors.cyan('Display:')} Type ${colors.boldYellow("'d'")} to refresh the sector display.`,
    );
    ctx.term.writeln(
        `${colors.cyan('Port:')} Type ${colors.boldYellow("'p'")} to access a port ${mg('(')}if one exists${mg(')')}.`,
    );
    ctx.term.writeln(
        `${colors.cyan('Ship Info:')} Type ${colors.boldYellow("'i'")} to view your ship and cargo.`,
    );
    ctx.term.writeln(
        `${colors.cyan('Help:')} Type ${colors.boldYellow("'?'")} to view this help menu.`,
    );
    ctx.term.writeln(
        `${colors.cyan('Exit Help:')} Press ${colors.boldYellow("'q'")} to return to the game.`,
    );
}

export function showPortMenu(ctx: GameContext) {
    if (!ctx.currentPort) {
        ctx.term.writeln(`\r\n${colors.boldRed('No port in this sector.')}`);
        showPrompt(ctx);
        return;
    }
    ctx.setMode('port');
    const label = PORT_CLASS_LABELS[ctx.currentPort.class] ?? '???';
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldCyan(ctx.currentPort.name)}${colors.boldYellow(',')} ${mg('Class')} ${colors.boldCyan(String(ctx.currentPort.class))} ${mg('(')}${colors.boldWhite(label)}${mg(')')}`,
    );
    ctx.term.writeln(`  ${colors.cyan('T')}  Trade at this port`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Never mind`);
}

export function showDockedMenu(ctx: GameContext) {
    if (!ctx.dockedPortInfo) return;
    const p = ctx.dockedPortInfo;
    const actions = PORT_CLASS_ACTIONS[p.class];
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldGreen('Docked')} at ${colors.boldCyan(`Port ${p.sectorId}`)}${colors.boldYellow(',')} ${mg('Class')} ${colors.boldCyan(String(p.class))}`,
    );
    if (actions) {
        ctx.term.writeln(
            `  ${colors.boldWhite('Commodity'.padEnd(14))} ${colors.boldWhite('Price'.padStart(5))}   ${colors.boldWhite('Stock'.padStart(5))}   ${colors.boldWhite('Port')}`,
        );
        const goods = [
            { name: 'Fuel', key: 'fuel', price: p.fuelPrice, stock: p.fuel },
            { name: 'Organics', key: 'organics', price: p.orgPrice, stock: p.organics },
            { name: 'Equipment', key: 'equipment', price: p.equPrice, stock: p.equipment },
        ];
        for (const g of goods) {
            const action = actions[g.key];
            const dir = action === 'B' ? colors.boldGreen('Buying') : colors.boldRed('Selling');
            ctx.term.writeln(
                `  ${colors.boldYellow(g.name.padEnd(14))} ${colors.white(String(g.price).padStart(5))}   ${colors.white(String(g.stock).padStart(5))}   ${dir}`,
            );
        }
        ctx.term.writeln('');
        ctx.term.writeln(`  ${colors.cyan('B')} <good> <qty>  Buy from port`);
        ctx.term.writeln(`  ${colors.cyan('S')} <good> <qty>  Sell to port`);
    } else {
        ctx.term.writeln(`  ${colors.cyan('This is a special port.')}`);
    }
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave port`);
}

export function showShipInfo(ctx: GameContext) {
    ctx.setMode('shipInfo');
    ctx.sendMsg({ type: ClientMsgType.ShipInfo });
    ctx.sendMsg({ type: ClientMsgType.CargoInfo });
}
