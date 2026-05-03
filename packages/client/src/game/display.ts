import { ClientMsgType } from '@twnr/shared';
import type { SectorRef } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { COMMAND, SECTOR, HELP, HELP_LINES, PORT, COMMON } from './messages/index.js';
import { showPrompt } from './menus/types.js';

export type DisplayCtx = Pick<GameContext, 'catalogs' | 'io' | 'minimap' | 'player' | 'world'>;

/**
 * Echo a command-name banner (e.g. `<Move>`, `<Take Colonists>`) to the
 * terminal. Called from input handlers when the user keys a command at a
 * menu — *not* from sendMsg. The two are deliberately decoupled because
 * multi-step flows (e.g. Take Colonists → commodity → qty) start with a
 * user keystroke that should echo immediately, but the corresponding
 * ClientMsg isn't sent until the prompts are filled in.
 */
export function echoCommand(
    ctx: DisplayCtx,
    key: keyof typeof COMMAND,
    vars?: Record<string, unknown>,
): void {
    const tpl = COMMAND[key];
    if (tpl) ctx.io.term.writeln(render(tpl, vars ?? {}));
}

function colorSectorRef(ref: SectorRef): string {
    const tpl = ref.visited ? SECTOR.warpVisited : SECTOR.warpUnvisited;
    return render(tpl, { sector: ref.sector });
}

function portClassLabel(cls: number): string {
    const key = `classLabel${cls}`;
    const tpl = (PORT as Record<string, string>)[key] ?? PORT.classLabelUnknown;
    return render(tpl);
}

export function showSectorDisplay(
    ctx: DisplayCtx,
    sector: number,
    warps: SectorRef[],
    players: { id: number; name: string }[],
    port?: { class: number; name: string } | null,
    sectorDrones?: { quantity: number; ownerId: number | null; ownerName: string } | null,
    planets?: { id: number; name: string; type: string }[],
    ships?: { id: number; name: string; typeName: string; ownerName: string }[],
    collisions?: { planetName: string; collidingWithName: string; collisionAt: string }[],
) {
    ctx.world.visitedSet.add(sector);
    ctx.world.currentSector = sector;
    ctx.world.currentPort = port ?? null;
    ctx.world.currentWarps = warps;
    const { term } = ctx.io;
    const comma = render(SECTOR.commaJoin);
    term.writeln('');
    term.writeln(render(SECTOR.header, { sector }));

    if (port) {
        term.writeln(
            render(SECTOR.port, {
                name: port.name,
                class: port.class,
                label: portClassLabel(port.class),
            }),
        );
    }

    if (sectorDrones && sectorDrones.quantity > 0) {
        const tpl =
            sectorDrones.ownerId === ctx.player.id ? SECTOR.dronesYours : SECTOR.dronesEnemy;
        term.writeln(render(tpl, { qty: sectorDrones.quantity, owner: sectorDrones.ownerName }));
    }

    if (planets && planets.length > 0) {
        const list = planets
            .map((p) => render(SECTOR.planetItem, { name: p.name, type: p.type }))
            .join(comma);
        term.writeln(render(SECTOR.planetsLine, { list }));
    }

    if (collisions && collisions.length > 0) {
        for (const c of collisions) {
            const eta = new Date(c.collisionAt);
            const hours = Math.max(0, Math.round((eta.getTime() - Date.now()) / 3600000));
            term.writeln(
                render(SECTOR.collisionWarning, {
                    planet: c.planetName,
                    target: c.collidingWithName,
                    hours,
                }),
            );
        }
    }

    if (players.length > 0) {
        const list = players.map((p) => render(SECTOR.playerItem, { name: p.name })).join(comma);
        term.writeln(render(SECTOR.playersLine, { list }));
    }

    if (ships && ships.length > 0) {
        const list = ships
            .map((s) => render(SECTOR.shipItem, { type: s.typeName, owner: s.ownerName }))
            .join(comma);
        term.writeln(render(SECTOR.shipsLine, { list }));
    }

    if (warps.length > 0) {
        const list = warps.map((w) => colorSectorRef(w)).join(render(SECTOR.warpSeparator));
        term.writeln(render(SECTOR.warpsLine, { list }));
    }
}

/** Sector menu's specific prompt. The generic "render whatever prompt
 * the current menu wants" lives in menus/index.ts as `showPrompt`. */
export function showSectorPrompt(ctx: DisplayCtx) {
    ctx.io.term.write(render(SECTOR.prompt, { sector: ctx.world.currentSector }));
}

export function showMoveMenu(ctx: DisplayCtx) {
    const warps = ctx.world.currentWarps.slice(0, 6);
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(SECTOR.moveMenuHeader));
    warps.forEach((w, i) => {
        const tpl = w.visited ? SECTOR.warpVisited : '[br]{sector}[/br]';
        const sector = render(tpl, { sector: w.sector });
        term.writeln(render(SECTOR.moveMenuRow, { n: i + 1, sector }));
    });
    term.writeln(render(SECTOR.moveMenuQuit));
    term.write(render(SECTOR.moveMenuPrompt, { max: warps.length }));
    // Light up the minimap with 1..N badges for each adjacent sector.
    ctx.minimap.handle?.setQuickMove(warps.map((w) => w.sector));
}

/** Clear the minimap quick-move overlay. Call whenever the Move menu closes. */
export function hideMoveMenuOverlay(ctx: DisplayCtx) {
    ctx.minimap.handle?.setQuickMove(null);
}

export function showHelp(ctx: DisplayCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(HELP.header));
    for (const line of HELP_LINES) {
        const tpl = 'key' in line ? HELP.lineKey : HELP.lineText;
        ctx.io.term.writeln(render(tpl, line));
    }
    ctx.io.term.writeln(render(HELP.footer));
    showPrompt(ctx as GameContext);
}

export function showPortMenu(ctx: DisplayCtx) {
    if (!ctx.world.currentPort) {
        ctx.io.term.writeln(render(PORT.menuNoPort));
        showPrompt(ctx as GameContext);
        return;
    }
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PORT.menuHeader, {
            name: ctx.world.currentPort.name,
            class: ctx.world.currentPort.class,
            label: portClassLabel(ctx.world.currentPort.class),
        }),
    );
    ctx.io.term.writeln(
        render(COMMON.menuRow, {
            key: ctx.world.currentPort.class === 9 ? 'S' : 'T',
            text: ctx.world.currentPort.class === 9 ? 'Enter Starbase' : 'Trade at this port',
        }),
    );
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Never mind' }));
}

export function showCommerceReport(
    ctx: DisplayCtx,
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
    void portClass;
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(PORT.commerceHeader, { name: portName }));
    term.writeln('');
    term.writeln(
        render(PORT.commerceColumns, {
            items: 'Items'.padEnd(12),
            status: 'Status'.padEnd(10),
            trading: 'Trading'.padStart(7),
            pct: '% of max'.padStart(8),
            onBoard: 'OnBoard'.padStart(7),
        }),
    );
    term.writeln(
        render(PORT.commerceDividers, {
            items: '-----'.padEnd(12),
            status: '------'.padEnd(10),
            trading: '-------'.padStart(7),
            pct: '--------'.padStart(8),
            onBoard: '-------'.padStart(7),
        }),
    );
    for (const g of goods) {
        const pct = g.max > 0 ? Math.round((g.trading / g.max) * 100) : 0;
        const tpl = g.status === 'Buying' ? PORT.commerceRowBuying : PORT.commerceRowSelling;
        term.writeln(
            render(tpl, {
                name: g.name.padEnd(12),
                status: g.status.padEnd(10),
                trading: String(g.trading).padStart(7),
                pct: String(pct).padStart(7),
                onBoard: String(g.onBoard).padStart(7),
            }),
        );
    }
    term.writeln('');
    term.writeln(
        render(PORT.commerceFooter, {
            credits: credits.toLocaleString(),
            holds: emptyHolds,
        }),
    );
}

export async function showPlayerInfo(ctx: DisplayCtx) {
    // Prefetch hardware catalog so the ShipInfo panel can label hardware items.
    if (!ctx.catalogs.hardware) {
        try {
            const res = await fetch('/api/hardware');
            ctx.catalogs.hardware = await res.json();
        } catch {
            ctx.catalogs.hardware = [];
        }
    }
    ctx.io.sendMsg({ type: ClientMsgType.ShipInfo });
}
