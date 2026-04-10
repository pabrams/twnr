import { ClientMsgType } from '@twnr/shared';
import type { SectorRef } from '@twnr/shared';
import type { GameContext } from './types.js';
import { colors, PORT_CLASS_LABELS } from './constants.js';

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
    planets?: { id: number; name: string; type: string }[],
    ships?: { id: number; name: string; typeName: string; ownerName: string }[],
    collisions?: { planetName: string; collidingWithName: string; collisionAt: string }[],
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
    if (planets && planets.length > 0) {
        ctx.term.writeln(
            `${mg('Planets')} ${cl} ${planets.map((p) => `${colors.boldCyan(p.name)} ${mg('(')}${colors.white(p.type)}${mg(')')}`).join(colors.boldYellow(', '))}`,
        );
    }
    if (collisions && collisions.length > 0) {
        for (const c of collisions) {
            const eta = new Date(c.collisionAt);
            const hoursLeft = Math.max(0, Math.round((eta.getTime() - Date.now()) / 3600000));
            ctx.term.writeln(
                `${colors.boldRed('WARNING')}: ${colors.boldYellow(c.planetName)} on collision course with ${colors.boldYellow(c.collidingWithName)}! ${mg('(')}ETA: ${colors.boldRed(String(hoursLeft))}h${mg(')')}`,
            );
        }
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
    if (ships && ships.length > 0) {
        ctx.term.writeln(
            `${mg('Ships')}   ${cl} ${ships.map((s) => `${colors.boldCyan(s.typeName)} ${mg('(')}${colors.boldYellow(s.ownerName)}${mg(')')}`).join(colors.boldYellow(', '))}`,
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
    ctx.term.writeln(
        `${colors.cyan('Deployed:')} ${colors.boldYellow("'G'")} list deployed drones.`,
    );
    ctx.term.writeln(`${colors.cyan('Land:')} ${colors.boldYellow("'L'")} land on a planet.`);
    ctx.term.writeln(
        `${colors.cyan('Terraform:')} ${colors.boldYellow("'U'")} use terraform device.`,
    );
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

export function showCommerceReport(
    ctx: GameContext,
    portName: string,
    portClass: number,
    goods: {
        name: string;
        key: string;
        status: string;
        trading: number;
        max: number;
        onBoard: number;
    }[],
    credits: number,
    emptyHolds: number,
) {
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldGreen('Commerce report for')} ${colors.boldCyan(portName)}`);
    ctx.term.writeln('');
    ctx.term.writeln(
        ` ${colors.boldWhite('Items'.padEnd(12))}${colors.boldWhite('Status'.padEnd(10))}${colors.boldWhite('Trading'.padStart(7))} ${colors.boldWhite('% of max'.padStart(8))} ${colors.boldWhite('OnBoard'.padStart(7))}`,
    );
    ctx.term.writeln(
        ` ${colors.white('-----'.padEnd(12))}${colors.white('------'.padEnd(10))}${colors.white('-------'.padStart(7))} ${colors.white('--------'.padStart(8))} ${colors.white('-------'.padStart(7))}`,
    );
    for (const g of goods) {
        const pct = g.max > 0 ? Math.round((g.trading / g.max) * 100) : 0;
        const statusColor =
            g.status === 'Buying'
                ? colors.boldGreen(g.status.padEnd(10))
                : colors.boldRed(g.status.padEnd(10));
        ctx.term.writeln(
            ` ${colors.boldYellow(g.name.padEnd(12))}${statusColor}${colors.white(String(g.trading).padStart(7))} ${colors.white((pct + '%').padStart(8))} ${colors.white(String(g.onBoard).padStart(7))}`,
        );
    }
    ctx.term.writeln('');
    ctx.term.writeln(
        `${mg('You have')} ${colors.boldYellow(credits.toLocaleString())} ${mg('credits and')} ${colors.boldYellow(String(emptyHolds))} ${mg('empty cargo holds.')}`,
    );
}

export function showPlayerInfo(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldGreen('Player')}: ${colors.boldCyan(ctx.playerName)}`);
    ctx.term.writeln(
        `${colors.boldGreen('Sector')}: ${colors.boldCyan(String(ctx.currentSector))}`,
    );
    ctx.sendMsg({ type: ClientMsgType.ShipInfo });
}
