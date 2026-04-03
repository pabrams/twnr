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
    playerName: string;
    playerId: number;
    totalSectors: number;
    sectorPlayers: { id: number; name: string }[];
    attackTarget: number | null;
    class0BuyType: 'fighters' | 'shields' | 'holds' | null;
    shipConfigs: any[] | null;
    planetConfigs: any[] | null;
    currentShipName: string;
    ws: WebSocket;
    sendMsg: (msg: ClientMessage) => void;
    setMode: (mode: MenuMode) => void;
    setCurrentSector: (sector: number) => void;
    setCurrentPort: (port: { class: number; name: string } | null) => void;
    setVisitedSet: (set: Set<number>) => void;
    setDockedPortInfo: (p: PortInfoMessage | null) => void;
    setPlayerName: (name: string) => void;
    setPlayerId: (id: number) => void;
    setTotalSectors: (n: number) => void;
    setSectorPlayers: (players: { id: number; name: string }[]) => void;
    setAttackTarget: (id: number | null) => void;
    setClass0BuyType: (t: 'fighters' | 'shields' | 'holds' | null) => void;
    setShipConfigs: (configs: any[]) => void;
    setPlanetConfigs: (configs: any[]) => void;
    setCurrentShipName: (name: string) => void;
    autopilotPath: number[];
    autopilotStep: number;
    setAutopilotPath: (path: number[]) => void;
    setAutopilotStep: (step: number) => void;
}

const mg = colors.magenta;

export function colorSector(sector: number, visitedSet: Set<number>): string {
    const num = String(sector);
    if (visitedSet.has(sector)) return colors.boldCyan(num);
    return `${mg('(')}${colors.boldRed(num)}${mg(')')}`;
}

export function showAutopilotPrompt(ctx: GameContext, path: number[], hops: number) {
    ctx.setAutopilotPath(path);
    ctx.setAutopilotStep(1);
    ctx.setMode('autopilotPrompt');
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldYellow('That sector is not adjacent.')} Shortest path ${mg('(')}${colors.boldCyan(String(hops))} hops${mg(')')}:`,
    );
    ctx.term.writeln(
        `  ${path.map((s) => colorSector(s, ctx.visitedSet)).join(` ${colors.green('>')} `)}`,
    );
    ctx.term.write(
        `\r\n${colors.cyan('Engage autopilot?')} ${mg('(')}${colors.boldYellow('Y')}/${colors.boldYellow('N')}${mg(')')} `,
    );
}

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
            `${colors.boldGreen('Warps')}   ${cl} ${warps.map((w) => colorSector(w, ctx.visitedSet)).join(` ${colors.green('-')} `)}`,
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
        `${colors.cyan('Display:')} ${colors.boldYellow("'D'")} refresh sector display.`,
    );
    ctx.term.writeln(`${colors.cyan('Port:')} ${colors.boldYellow("'P'")} access a port.`);
    ctx.term.writeln(
        `${colors.cyan('Info:')} ${colors.boldYellow("'I'")} view player and ship info.`,
    );
    ctx.term.writeln(
        `${colors.cyan('Attack:')} ${colors.boldYellow("'A'")} attack a player in your sector.`,
    );
    ctx.term.writeln(`${colors.cyan('Computer:')} ${colors.boldYellow("'C'")} ship computer.`);
    ctx.term.writeln(`${colors.cyan('Help:')} ${colors.boldYellow("'?'")} this menu.`);
    ctx.term.writeln(`${colors.cyan('Quit:')} ${colors.boldYellow("'Q'")} quit the game.`);
    ctx.term.writeln('');
    ctx.term.writeln(`Press ${colors.boldYellow("'Q'")} to return.`);
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

export function showPlayerInfo(ctx: GameContext) {
    ctx.setMode('playerInfo');
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldGreen('Player')}: ${colors.boldCyan(ctx.playerName)}`);
    ctx.term.writeln(
        `${colors.boldGreen('Sector')}: ${colors.boldCyan(String(ctx.currentSector))}`,
    );
    ctx.sendMsg({ type: ClientMsgType.ShipInfo });
    ctx.sendMsg({ type: ClientMsgType.CargoInfo });
}

export function showAttackMenu(ctx: GameContext) {
    if (ctx.sectorPlayers.length === 0) {
        ctx.term.writeln(`\r\n${colors.boldRed('No other players in this sector.')}`);
        showPrompt(ctx);
        return;
    }
    ctx.setMode('attack');
    ctx.term.writeln('');
    ctx.term.writeln(colors.cyan('Attack — Select target:'));
    ctx.sectorPlayers.forEach((p, i) => {
        ctx.term.writeln(`  ${colors.boldYellow(String(i + 1))}  ${colors.white(p.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Cancel`);
}

export function showAttackFightersPrompt(ctx: GameContext) {
    ctx.setMode('attackFighters');
    ctx.term.write(`\r\n${colors.cyan('How many fighters to attack with?')} `);
}

export function showClass0Menu(ctx: GameContext) {
    ctx.setMode('class0');
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldGreen('Docked')} at ${colors.boldCyan('Stardock Supply Depot')}`,
    );
    ctx.term.writeln(`  ${colors.cyan('F')}  Buy Fighters ${colors.white('(20 credits each)')}`);
    ctx.term.writeln(`  ${colors.cyan('S')}  Buy Shields ${colors.white('(10 credits each)')}`);
    ctx.term.writeln(`  ${colors.cyan('H')}  Buy Holds ${colors.white('(50 credits each)')}`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave port`);
}

export function showClass0QtyPrompt(ctx: GameContext, buyType: string) {
    ctx.setMode('class0Qty');
    ctx.term.write(`\r\n${colors.cyan(`How many ${buyType}?`)} `);
}

export function showComputerMenu(ctx: GameContext) {
    ctx.setMode('computer');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Ship Computer ==='));
    ctx.term.writeln(`  ${colors.cyan('K')}  Known Universe`);
    ctx.term.writeln(`  ${colors.cyan('C')}  Ship Catalog`);
    ctx.term.writeln(`  ${colors.cyan('J')}  Planetary Specs`);
    ctx.term.writeln(`  ${colors.cyan(';')}  Current Ship Specs`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Exit Computer`);
}

export function showKnownUniverseMenu(ctx: GameContext) {
    ctx.setMode('knownUniverse');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('Known Universe'));
    ctx.term.writeln(`  ${colors.cyan('E')}  Explored sectors`);
    ctx.term.writeln(`  ${colors.cyan('U')}  Unexplored sectors`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showExploredSectors(ctx: GameContext) {
    const explored = Array.from(ctx.visitedSet).sort((a, b) => a - b);
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldCyan('Explored sectors')} (${explored.length}):`);
    ctx.term.writeln(explored.map((s) => colors.boldCyan(String(s))).join(' '));
}

export function showUnexploredSectors(ctx: GameContext) {
    const unexplored: number[] = [];
    for (let i = 1; i <= ctx.totalSectors; i++) {
        if (!ctx.visitedSet.has(i)) unexplored.push(i);
    }
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldCyan('Unexplored sectors')} (${unexplored.length}):`);
    ctx.term.writeln(unexplored.map((s) => colors.boldRed(String(s))).join(' '));
}

export async function showShipCatalog(ctx: GameContext) {
    ctx.setMode('shipCatalog');
    if (!ctx.shipConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading ship catalog...')}`);
        try {
            const res = await fetch('/api/ships');
            ctx.setShipConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showComputerMenu(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Ship Catalog ==='));
    ctx.shipConfigs!.forEach((ship: any, i: number) => {
        const letter = String.fromCharCode(65 + i);
        ctx.term.writeln(`  ${colors.boldYellow(letter)}  ${colors.white(ship.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showShipDetail(ctx: GameContext, ship: any) {
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan(`=== ${ship.name} ===`));
    ctx.term.writeln(
        `  ${colors.boldYellow('Price'.padEnd(16))} ${colors.white(String(ship.price))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Fighters'.padEnd(16))} ${colors.white(String(ship.maxFighters))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Shields'.padEnd(16))} ${colors.white(String(ship.maxShields))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Starting Holds'.padEnd(16))} ${colors.white(String(ship.startingHolds))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Holds'.padEnd(16))} ${colors.white(String(ship.maxHolds))}`,
    );
    ctx.term.writeln('');
    ctx.term.writeln(`Press ${colors.boldYellow('Q')} to go back.`);
}

export async function showPlanetSpecs(ctx: GameContext) {
    ctx.setMode('planetSpecs');
    if (!ctx.planetConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading planetary specs...')}`);
        try {
            const res = await fetch('/api/planets');
            ctx.setPlanetConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load planetary specs.'));
            showComputerMenu(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Planetary Specifications ==='));
    ctx.planetConfigs!.forEach((planet: any, i: number) => {
        const letter = String.fromCharCode(65 + i);
        ctx.term.writeln(`  ${colors.boldYellow(letter)}  ${colors.white(planet.type)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showPlanetDetail(ctx: GameContext, planet: any) {
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan(`=== ${planet.type} ===`));
    ctx.term.writeln(`  ${colors.white(planet.description)}`);
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Colonists'.padEnd(20))} ${colors.white(String(planet.maxColonists))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Citadel'.padEnd(20))} ${colors.white(String(planet.maxCitadel))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Fuel Production'.padEnd(20))} ${colors.white(String(planet.fuelProduction))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Organics Production'.padEnd(20))} ${colors.white(String(planet.organicsProduction))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Equip Production'.padEnd(20))} ${colors.white(String(planet.equipmentProduction))}`,
    );
    ctx.term.writeln('');
    ctx.term.writeln(`Press ${colors.boldYellow('Q')} to go back.`);
}

export async function showCurrentShipSpecs(ctx: GameContext) {
    if (!ctx.shipConfigs) {
        try {
            const res = await fetch('/api/ships');
            ctx.setShipConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            return;
        }
    }
    if (!ctx.currentShipName) {
        ctx.term.writeln(colors.white('Requesting ship data...'));
        ctx.sendMsg({ type: ClientMsgType.ShipInfo });
        return;
    }
    const ship = ctx.shipConfigs!.find((s: any) => s.name === ctx.currentShipName);
    if (!ship) {
        ctx.term.writeln(colors.boldRed(`Ship config not found for: ${ctx.currentShipName}`));
        return;
    }
    showShipDetail(ctx, ship);
}
