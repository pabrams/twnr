import { ClientTag } from '@twnr/shared';
import type { SectorRef, OwnershipInfo, SectorDisplayData } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { COMMAND, SECTOR, HELP, HELP_LINES, PORT, COMMON } from './messages/index.js';
import { showPrompt } from './routines/types.js';

function renderOwnership(
    ownership: OwnershipInfo,
    viewerPlayerId: number,
    viewerClanId: number | null,
): string {
    if (ownership.kind === 'player') {
        if (ownership.playerId === viewerPlayerId) {
            return render(SECTOR.ownershipYours);
        }
        return render(SECTOR.ownershipPlayer, { name: ownership.name });
    }
    if (ownership.kind === 'clan') {
        if (viewerClanId !== null && ownership.clanId === viewerClanId) {
            return render(SECTOR.ownershipYourClan);
        }
        return render(SECTOR.ownershipClan, {
            num: ownership.clanNumber,
            name: ownership.name,
        });
    }
    return render(SECTOR.ownershipRogue);
}

function renderShipOwnership(
    ownership: OwnershipInfo,
    viewerPlayerId: number,
    viewerClanId: number | null,
): string {
    if (ownership.kind === 'player' && ownership.playerId !== viewerPlayerId) {
        const clanSuffix =
            ownership.ownerClanNumber !== null
                ? render(SECTOR.traderClanSuffix, { num: ownership.ownerClanNumber })
                : '';
        return render(SECTOR.ownershipPlayerOwnedBy, { name: ownership.name, clanSuffix });
    }
    return renderOwnership(ownership, viewerPlayerId, viewerClanId);
}

/** True iff this row's ownership belongs to the viewer's clan (not them personally). */
function isOwnClan(ownership: OwnershipInfo, viewerClanId: number | null): boolean {
    return ownership.kind === 'clan' && viewerClanId !== null && ownership.clanId === viewerClanId;
}

export type DisplayCtx = Pick<GameContext, 'catalogs' | 'io' | 'minimap' | 'player' | 'world'>;

export function echoCommand(
    ctx: DisplayCtx,
    key: keyof typeof COMMAND,
    vars?: Record<string, unknown>,
): void {
    const tpl = COMMAND[key];
    if (tpl) ctx.io.term.writeln(render(tpl, vars ?? {}));
}

export function echoMenuCommand(ctx: DisplayCtx, commandName: string): void {
    const menu = ctx.catalogs.menus.get(ctx.world.mode);
    const row = menu?.commands.find((c) => c.command === commandName);
    if (!row) return;
    ctx.io.term.writeln(render(`\r\n[bc]<${row.label}>[/bc]`));
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

export function showSectorDisplay(ctx: DisplayCtx, data: SectorDisplayData) {
    const {
        sector,
        warps,
        players,
        port,
        portConstruction,
        sectorDrones,
        planets,
        ships,
        collisions,
        sectorMines,
        beacon,
    } = data;
    ctx.world.visitedSet.add(sector);
    ctx.world.currentSector = sector;
    ctx.world.currentPort = port ?? null;
    ctx.world.currentPortConstruction = portConstruction ?? null;
    ctx.world.currentWarps = warps;
    const viewerId = ctx.player.id;
    const viewerClanId = ctx.player.clanId;
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(SECTOR.header, { sector }));

    if (beacon) {
        term.writeln(render(SECTOR.beaconLine, { message: beacon.message }));
    }

    if (port) {
        term.writeln(
            render(SECTOR.port, {
                name: port.name,
                class: port.class,
                label: portClassLabel(port.class),
            }),
        );
    } else if (portConstruction) {
        term.writeln(
            render(SECTOR.portUnderConstruction, {
                name: portConstruction.name,
                class: portConstruction.class,
                label: portClassLabel(portConstruction.class),
                days: portConstruction.daysLeft,
            }),
        );
    }

    if (sectorDrones && sectorDrones.quantity > 0) {
        if (sectorDrones.ownerId === viewerId) {
            term.writeln(render(SECTOR.dronesYours, { qty: sectorDrones.quantity }));
        } else if (isOwnClan(sectorDrones.ownership, viewerClanId)) {
            term.writeln(render(SECTOR.dronesYourClan, { qty: sectorDrones.quantity }));
        } else {
            term.writeln(
                render(SECTOR.dronesEnemy, {
                    qty: sectorDrones.quantity,
                    ownership: renderOwnership(sectorDrones.ownership, viewerId, viewerClanId),
                }),
            );
        }
    }

    if (planets && planets.length > 0) {
        planets.forEach((p, i) => {
            const item = render(SECTOR.planetItemPlain, {
                name: p.name,
                type: p.displayType ?? p.type,
            });
            term.writeln(
                render(i === 0 ? SECTOR.planetsLine : SECTOR.planetsContinuation, { item }),
            );
        });
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
        players.forEach((p, i) => {
            const clanSuffix =
                p.clanNumber !== null ? render(SECTOR.traderClanSuffix, { num: p.clanNumber }) : '';
            const item = p.shipTypeDisplayName
                ? render(SECTOR.traderItemColored, {
                      name: p.name,
                      clanSuffix,
                      drones: p.drones,
                      shipName: p.shipName,
                      shipTypeColored: p.shipTypeDisplayName,
                  })
                : render(SECTOR.traderItemPlain, {
                      name: p.name,
                      clanSuffix,
                      drones: p.drones,
                      shipName: p.shipName,
                      shipType: p.shipTypeName,
                  });
            term.writeln(
                render(i === 0 ? SECTOR.tradersLine : SECTOR.tradersContinuation, { item }),
            );
        });
    }

    if (ships && ships.length > 0) {
        ships.forEach((s, i) => {
            const ownership = renderShipOwnership(s.ownership, viewerId, viewerClanId);
            const item = s.typeDisplayName
                ? render(SECTOR.shipItemColored, {
                      shipName: s.name,
                      shipTypeColored: s.typeDisplayName,
                      ownership,
                      drones: s.drones,
                  })
                : render(SECTOR.shipItemPlain, {
                      shipName: s.name,
                      shipType: s.typeName,
                      ownership,
                      drones: s.drones,
                  });
            term.writeln(render(i === 0 ? SECTOR.shipsLine : SECTOR.shipsContinuation, { item }));
        });
    }

    if (sectorMines && sectorMines.length > 0) {
        const proximity = sectorMines.find((m) => m.mineType === 'proximity');
        const limpet = sectorMines.find((m) => m.mineType === 'seeker');
        const renderMineLine = (
            row: { quantity: number; ownership: OwnershipInfo },
            ownTpl: string,
            yourClanTpl: string,
            enemyTpl: string,
        ) => {
            const isMine = row.ownership.kind === 'player' && row.ownership.playerId === viewerId;
            if (isMine) {
                term.writeln(render(ownTpl, { qty: row.quantity }));
            } else if (isOwnClan(row.ownership, viewerClanId)) {
                term.writeln(render(yourClanTpl, { qty: row.quantity }));
            } else {
                term.writeln(
                    render(enemyTpl, {
                        qty: row.quantity,
                        ownership: renderOwnership(row.ownership, viewerId, viewerClanId),
                    }),
                );
            }
        };
        if (proximity) {
            renderMineLine(
                proximity,
                SECTOR.minesLine,
                SECTOR.minesLineYourClan,
                SECTOR.minesLineEnemy,
            );
        }
        if (limpet) {
            renderMineLine(
                limpet,
                SECTOR.limpetsLine,
                SECTOR.limpetsLineYourClan,
                SECTOR.limpetsLineEnemy,
            );
        }
    }

    if (warps.length > 0) {
        const list = warps.map((w) => colorSectorRef(w)).join(render(SECTOR.warpSeparator));
        term.writeln(render(SECTOR.warpsLine, { list }));
    }
}

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
        const construction = ctx.world.currentPortConstruction;
        if (construction) {
            ctx.io.term.writeln(
                render(PORT.menuUnderConstruction, {
                    name: construction.name,
                    days: construction.daysLeft,
                }),
            );
        } else {
            ctx.io.term.writeln(render(PORT.menuNoPort));
        }
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
    ctx.io.sendMsg({ type: ClientTag.ShipInfo });
}
