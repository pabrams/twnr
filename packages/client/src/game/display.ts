import { ClientMsgType } from '@twnr/shared';
import type { SectorRef } from '@twnr/shared';
import type { GameContext } from './types.js';
import { colors, PORT_CLASS_LABELS, PORT_CLASS_ACTIONS } from './constants.js';

// Re-export GameContext so existing imports from './display.js' still work
export type { GameContext } from './types.js';

const mg = colors.magenta;

function colorSectorRef(ref: SectorRef): string {
    const num = String(ref.sector);
    if (ref.visited) return colors.boldCyan(num);
    return `${mg('(')}${colors.boldRed(num)}${mg(')')}`;
}

export function showSectorDisplay(
    ctx: GameContext,
    sector: number,
    warps: SectorRef[],
    players: { id: number; name: string }[],
    port?: { class: number; name: string } | null,
    sectorDrones?: { quantity: number; ownerId: number | null; ownerName: string } | null,
) {
    ctx.visitedSet.add(sector);
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
    if (sectorDrones && sectorDrones.quantity > 0) {
        const label =
            sectorDrones.ownerId === ctx.playerId
                ? `${colors.boldGreen(String(sectorDrones.quantity))} ${mg('(yours)')}`
                : `${colors.boldRed(String(sectorDrones.quantity))} ${mg('(')}${colors.boldYellow(sectorDrones.ownerName)}${mg(')')}`;
        ctx.term.writeln(`${mg('Drones')}  ${cl} ${label}`);
    }
    if (warps.length > 0) {
        ctx.term.writeln(
            `${colors.boldGreen('Warps')}   ${cl} ${warps.map((w) => colorSectorRef(w)).join(` ${colors.green('-')} `)}`,
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
    ctx.term.writeln('');
    ctx.term.writeln(colors.cyan('Help:'));
    ctx.term.writeln(`${colors.cyan('Command:')} Move to a sector by typing its number.`);
    ctx.term.writeln(
        `${colors.cyan('Display:')} ${colors.boldYellow("'D'")} refresh sector display.`,
    );
    ctx.term.writeln(`${colors.cyan('Port:')} ${colors.boldYellow("'P'")} access a port.`);
    ctx.term.writeln(
        `${colors.cyan('Info:')} ${colors.boldYellow("'I'")} view player and ship info.`,
    );
    ctx.term.writeln(
        `${colors.cyan('Attack:')} ${colors.boldYellow("'A'")} attack a player in your sector.`,
    );
    ctx.term.writeln(`${colors.cyan('Jettison:')} ${colors.boldYellow("'J'")} jettison all cargo.`);
    ctx.term.writeln(`${colors.cyan('Drones:')} ${colors.boldYellow("'F'")} deploy sector drones.`);
    ctx.term.writeln(`${colors.cyan('Land:')} ${colors.boldYellow("'L'")} land on a planet.`);
    ctx.term.writeln(`${colors.cyan('Computer:')} ${colors.boldYellow("'C'")} ship computer.`);
    ctx.term.writeln(
        `${colors.cyan('Starbase:')} ${colors.boldYellow("'V'")} show Starbase location.`,
    );
    ctx.term.writeln(`${colors.cyan('Who:')} ${colors.boldYellow("'#'")} players online.`);
    ctx.term.writeln(`${colors.cyan('Help:')} ${colors.boldYellow("'?'")} this help.`);
    ctx.term.writeln(`${colors.cyan('Quit:')} ${colors.boldYellow("'Q'")} quit the game.`);
    showPrompt(ctx);
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
    if (ctx.currentPort.class === 9) {
        ctx.term.writeln(`  ${colors.cyan('S')}  Enter Starbase`);
    } else {
        ctx.term.writeln(`  ${colors.cyan('T')}  Trade at this port`);
    }
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

export function showPlayerInfo(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldGreen('Player')}: ${colors.boldCyan(ctx.playerName)}`);
    ctx.term.writeln(
        `${colors.boldGreen('Sector')}: ${colors.boldCyan(String(ctx.currentSector))}`,
    );
    ctx.sendMsg({ type: ClientMsgType.ShipInfo });
}
