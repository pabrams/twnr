import { Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, EVENT, PANEL } from '../messages/index.js';
import { showPrompt, showSectorDisplay } from '../display.js';
import {
    showPlanetMenu,
    showPlanetMenuOptions,
    showEarthMenu,
    showNoPlanet,
} from '../display-planet.js';
import { showPlanetSelectMenu } from '../display-starbase.js';
import { showComputerPrompt } from '../display-computer.js';
import type { Handler } from './index.js';
import { fmt, refreshMinimap } from './utils.js';

export const planetInfo: Handler<'planetInfoResult'> = (ctx, msg) => {
    if (msg.hasPlanet) showPlanetMenu(ctx, msg.name, msg.colonists);
    else showNoPlanet(ctx);
};

export const takeColonists: Handler<'takeColonistsResult'> = (ctx, msg) => {
    ctx.shipColonists = msg.shipColonists;
    ctx.term.writeln('');
    ctx.term.writeln(
        render(PANEL.takeColonistsHeader, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
        }),
    );
    ctx.term.writeln(render(PANEL.planetColonistsLine, { count: fmt(msg.planetColonists) }));
    ctx.term.writeln(render(PANEL.shipColonistsLine, { count: msg.shipColonists }));
};

export const leaveColonists: Handler<'leaveColonistsResult'> = (ctx, msg) => {
    ctx.shipColonists = msg.shipColonists;
    ctx.term.writeln('');
    ctx.term.writeln(
        render(PANEL.leaveColonistsHeader, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
        }),
    );
    ctx.term.writeln(render(PANEL.planetColonistsLine, { count: fmt(msg.planetColonists) }));
    ctx.term.writeln(render(PANEL.shipColonistsLine, { count: msg.shipColonists }));
    if (ctx.mode === Menu.PlanetEarth) {
        showEarthMenu(ctx, msg.planetColonists);
    } else if (ctx.mode === Menu.Planet) {
        showPlanetMenuOptions(ctx);
    }
};

export const land: Handler<'landResult'> = (ctx, msg) => {
    if (msg.planets.length > 0) {
        ctx.landablePlanets = msg.planets;
        showPlanetSelectMenu(ctx, msg.planets);
    } else {
        ctx.term.writeln(render(EVENT.noPlanetsToLand));
        showPrompt(ctx);
    }
};

export const landOnPlanet: Handler<'landOnPlanetResult'> = (ctx, msg) => {
    ctx.planetEmptyHolds = msg.empty_holds;
    ctx.shipColonists = msg.ship_colonists;
    if (ctx.mode === Menu.PlanetEarth) {
        showEarthMenu(ctx, msg.colonists_fuel ?? 0);
    } else {
        ctx.term.writeln('');
        ctx.term.writeln(render(PANEL.landedHeader, { name: msg.name }));
        ctx.term.writeln(render(PANEL.landedType, { type: msg.planetType }));
        ctx.term.writeln(
            render(PANEL.landedStats, {
                drones: msg.drones,
                fuel: msg.fuel,
                organics: msg.organics,
                equipment: msg.equipment,
            }),
        );
        ctx.term.writeln(
            render(PANEL.landedColonists, {
                fuel: msg.colonists_fuel ?? 0,
                organics: msg.colonists_organics ?? 0,
                equipment: msg.colonists_equipment ?? 0,
            }),
        );
        showPlanetMenuOptions(ctx);
    }
};

export const planetDisplay: Handler<'planetDisplayResult'> = (ctx, msg) => {
    ctx.planetEmptyHolds = msg.empty_holds;
    ctx.shipColonists = msg.ship_colonists;
    ctx.term.writeln('');
    ctx.term.writeln(render(PANEL.planetDisplayHeader, { name: msg.name, type: msg.planetType }));
    ctx.term.writeln(
        render(PANEL.landedStats, {
            drones: msg.drones,
            fuel: msg.fuel,
            organics: msg.organics,
            equipment: msg.equipment,
        }),
    );
    ctx.term.writeln(
        render(PANEL.landedColonists, {
            fuel: msg.colonists_fuel,
            organics: msg.colonists_organics,
            equipment: msg.colonists_equipment,
        }),
    );
    showPlanetMenuOptions(ctx);
};

export const destroyPlanet: Handler<'destroyPlanetResult'> = (ctx, msg) => {
    if (msg.destroyed) {
        ctx.term.writeln(render(EVENT.planetDestroyed, { name: msg.planetName }));
    }
    showPrompt(ctx);
};

export const useTerraformDevice: Handler<'useTerraformDeviceResult'> = (ctx, msg) => {
    if (msg.success && msg.planet) {
        ctx.term.writeln(
            render(EVENT.terraformSuccess, {
                name: msg.planet.name,
                type: msg.planet.type,
            }),
        );
        if (msg.collision) ctx.term.writeln(render(EVENT.terraformCollision));
        ctx.term.writeln(render(EVENT.terraformDevicesRemaining, { count: msg.terraformDevices }));
    } else {
        const reason =
            msg.reason === 'no_devices'
                ? 'No terraform devices on ship.'
                : msg.reason === 'restricted_sector'
                  ? 'Cannot terraform in this sector.'
                  : 'Terraform failed.';
        ctx.term.writeln(render(EVENT.terraformFailure, { reason }));
    }
    showPrompt(ctx);
};

export const leavePlanet: Handler<'leavePlanetResult'> = (ctx, msg) => {
    ctx.term.writeln(render(EVENT.leftPlanet));
    ctx.sectorPlayers = msg.players;
    showSectorDisplay(
        ctx,
        msg.sector,
        msg.warps,
        msg.players,
        msg.port,
        msg.sectorDrones,
        msg.planets,
        msg.ships,
        msg.collisions,
    );
    refreshMinimap(ctx);
};

export const listPlanets: Handler<'listPlanetsResult'> = (ctx, msg) => {
    ctx.term.writeln('');
    if (msg.planets.length === 0) {
        ctx.term.writeln(render(PANEL.listPlanetsEmpty));
    } else {
        ctx.term.writeln(render(PANEL.listPlanetsHeader));
        for (const p of msg.planets) {
            ctx.term.writeln(
                render(PANEL.listPlanetsRow, {
                    sector: p.sectorNumber,
                    name: p.name,
                    type: p.type,
                }),
            );
            ctx.term.writeln(
                render(PANEL.listPlanetsColonists, {
                    fuel: p.colonists_fuel,
                    organics: p.colonists_organics,
                    equipment: p.colonists_equipment,
                }),
            );
        }
    }
    showComputerPrompt(ctx);
};

export const terraformInfo: Handler<'terraformInfoResult'> = (ctx, msg) => {
    if (msg.canTerraform) {
        ctx.term.writeln(render(NOTIFY.terraformDevicesAvailable, { count: msg.devices }));
        ctx.term.write(render(NOTIFY.terraformConfirm));
    } else if (msg.reason === 'no_devices') {
        ctx.term.writeln(render(NOTIFY.terraformNoDevices));
        showPrompt(ctx);
    } else {
        ctx.term.writeln(render(NOTIFY.error, { message: 'Cannot terraform here.' }));
        showPrompt(ctx);
    }
};
