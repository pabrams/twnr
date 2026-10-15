import { ClientTag, ServerTag } from '@twnr/shared';
import type { HardwareCatalogItem, PlanetCatalogEntry, ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { COMPUTER, STARBASE } from '../messages/index.js';
import { request, type IOCtx } from './io.js';

export type CatalogCtx = IOCtx & Pick<GameContext, 'catalogs'>;

/**
 * Lazy loaders for the universe catalogs. Each issues its WS request on first
 * use and memoizes the reply on `ctx.catalogs`, so repeat visits to the
 * Computer / Shipyards menus don't round-trip. Returns null when the server
 * errored or the socket dropped (the Error handler has already printed the
 * reason) — callers bail the same way they do after `request`.
 */

export async function loadShipCatalog(ctx: CatalogCtx): Promise<ShipCatalogEntry[] | null> {
    if (ctx.catalogs.ships) return ctx.catalogs.ships;
    ctx.io.term.writeln(render(STARBASE.loadingShipCatalog));
    const reply = await request(ctx, { type: ClientTag.ShipCatalog }, ServerTag.ShipCatalogResult);
    if (!reply) return null;
    ctx.catalogs.ships = reply.ships;
    return reply.ships;
}

export async function loadPlanetCatalog(ctx: CatalogCtx): Promise<PlanetCatalogEntry[] | null> {
    if (ctx.catalogs.planets) return ctx.catalogs.planets;
    ctx.io.term.writeln(render(COMPUTER.planetSpecsLoading));
    const reply = await request(
        ctx,
        { type: ClientTag.PlanetCatalog },
        ServerTag.PlanetCatalogResult,
    );
    if (!reply) return null;
    ctx.catalogs.planets = reply.planets;
    return reply.planets;
}

export async function ensureHardwareCatalog(
    ctx: CatalogCtx,
): Promise<HardwareCatalogItem[] | null> {
    if (ctx.catalogs.hardware) return ctx.catalogs.hardware;
    const reply = await request(
        ctx,
        { type: ClientTag.HardwareCatalog },
        ServerTag.HardwareCatalogResult,
    );
    if (!reply) return null;
    ctx.catalogs.hardware = reply.items;
    return reply.items;
}
