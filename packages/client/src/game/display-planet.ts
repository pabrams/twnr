import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { PLANET, SECTOR, COMMON } from './messages/index.js';
import { showPrompt, type DisplayCtx } from './display.js';

export type DisplayPlanetCtx = Pick<GameContext, 'io' | 'ship'> & DisplayCtx;

export function showPlanetMenu(ctx: DisplayPlanetCtx, name: string, colonists: number) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.landing, { name }));
    ctx.io.term.writeln(render(PLANET.colonists, { count: colonists.toLocaleString() }));
    showPlanetPrompt(ctx);
}

export function showPlanetMenuOptions(ctx: DisplayPlanetCtx) {
    showPlanetPrompt(ctx);
}

export function showPlanetHelp(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'T', text: 'Take colonists aboard' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'L', text: 'Leave colonists on planet' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'D', text: 'Planet Info' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Z', text: 'Destroy Planet' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave Planet' }));
    showPlanetPrompt(ctx);
}

function showPlanetPrompt(ctx: DisplayPlanetCtx) {
    ctx.io.term.write(render(PLANET.prompt));
}

export function showEarthMenu(ctx: DisplayPlanetCtx, colonistsFuel: number) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.earthHeader, { count: colonistsFuel.toLocaleString() }));
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'T', text: 'Take colonists aboard' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'L', text: 'Leave colonists on planet' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave Earth' }));
}

export function showPlanetTakePrompt(ctx: DisplayPlanetCtx) {
    ctx.io.term.write(render(PLANET.takePrompt, { emptyHolds: ctx.ship.planetEmptyHolds }));
}

export function showPlanetLeavePrompt(ctx: DisplayPlanetCtx) {
    ctx.io.term.write(render(PLANET.leavePrompt, { shipColonists: ctx.ship.shipColonists }));
}

export function showPlanetTakeCommodityMenu(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.takeCommodityHeader));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel colonists' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics colonists' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment colonists' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
    ctx.io.term.write(render(PLANET.commodityPrompt));
}

export function showPlanetLeaveCommodityMenu(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.leaveCommodityHeader));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
    ctx.io.term.write(render(PLANET.commodityPrompt));
}

export function showNoPlanet(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(SECTOR.noPlanet));
    showPrompt(ctx);
}
