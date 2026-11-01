import { Commands } from '@twnr/shared';
import type { HardwareCatalogItem, PlanetCatalogEntry, ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { COMPUTER, STARBASE } from '../messages/index.js';
import { request, type IOCtx } from './io.js';

export type CatalogCtx = IOCtx & Pick<GameContext, 'catalogs'>;

export async function loadShipCatalog(ctx: CatalogCtx): Promise<ShipCatalogEntry[] | null> {
    if (ctx.catalogs.ships) return ctx.catalogs.ships;
    ctx.io.term.writeln(render(STARBASE.loadingShipCatalog));
    const reply = await request(ctx, Commands.ShipCatalog, {});
    if (!reply) return null;
    ctx.catalogs.ships = reply.ships;
    return reply.ships;
}

export async function loadPlanetCatalog(ctx: CatalogCtx): Promise<PlanetCatalogEntry[] | null> {
    if (ctx.catalogs.planets) return ctx.catalogs.planets;
    ctx.io.term.writeln(render(COMPUTER.planetSpecsLoading));
    const reply = await request(ctx, Commands.PlanetCatalog, {});
    if (!reply) return null;
    ctx.catalogs.planets = reply.planets;
    return reply.planets;
}

export async function ensureHardwareCatalog(
    ctx: CatalogCtx,
): Promise<HardwareCatalogItem[] | null> {
    if (ctx.catalogs.hardware) return ctx.catalogs.hardware;
    const reply = await request(ctx, Commands.HardwareCatalog, {});
    if (!reply) return null;
    ctx.catalogs.hardware = reply.items;
    return reply.items;
}
