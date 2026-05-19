import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { PANEL } from '../messages/index.js';
import { showSectorDisplay, type DisplayCtx } from '../display.js';
import type { Handler } from './index.js';
import { refreshMinimap, type RefreshMinimapCtx } from './utils.js';

type DensityCtx = Pick<GameContext, 'io'>;

/** Render the density-scan table. The `hasVisualScanner` flag is consumed
 *  by the `long_range_scan` routine, not here. */
export const densityScan: Handler<'densityScanResult', DensityCtx> = (ctx, msg) => {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(PANEL.densityScanTitle));
    term.writeln(render(PANEL.densityScanRule));
    for (const e of msg.entries) {
        const sectorField = e.visited
            ? render(PANEL.densityScanSectorVisited, { n: String(e.sector).padStart(5) })
            : render(PANEL.densityScanSectorUnvisited, { n: String(e.sector).padStart(5) });
        term.writeln(
            render(PANEL.densityScanRow, {
                sector: sectorField,
                density: String(e.density).padStart(5),
                warps: e.warps,
                navHaz: `${String(e.navHaz).padStart(3)}%`,
                anom: e.anom ? 'Yes' : 'No',
            }),
        );
    }
};

type VisualCtx = Pick<GameContext, 'catalogs' | 'io' | 'minimap' | 'player' | 'world'> &
    DisplayCtx &
    RefreshMinimapCtx;

/** Paint each adjacent sector as a full sector display, one after the
 *  other. We don't update `world.currentSector` etc. — the player is
 *  still in their original sector; we're just looking outward. */
export const visualScan: Handler<'visualScanResult', VisualCtx> = (ctx, msg) => {
    const savedSector = ctx.world.currentSector;
    const savedPort = ctx.world.currentPort;
    const savedPortConstruction = ctx.world.currentPortConstruction;
    const savedWarps = ctx.world.currentWarps;
    for (const data of msg.sectors) {
        showSectorDisplay(ctx, data);
    }
    // Restore the player's actual current sector state so subsequent
    // commands don't think they're in the last-scanned sector.
    ctx.world.currentSector = savedSector;
    ctx.world.currentPort = savedPort;
    ctx.world.currentPortConstruction = savedPortConstruction;
    ctx.world.currentWarps = savedWarps;
    // Newly-scanned sectors are now in the player's visited set; refresh
    // the minimap so they appear immediately (plus their outwarps as
    // glimpsed) without waiting for the next sector re-display.
    refreshMinimap(ctx);
};
