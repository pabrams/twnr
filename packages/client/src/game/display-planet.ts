import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { PLANET, SECTOR, COMMON } from './messages/index.js';
import { type DisplayCtx } from './display.js';

export type DisplayPlanetCtx = Pick<GameContext, 'io' | 'ship'> & DisplayCtx;

export function showPlanetMenu(ctx: DisplayPlanetCtx, name: string, colonists: number) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.landing, { name }));
    ctx.io.term.writeln(render(PLANET.colonists, { count: colonists.toLocaleString() }));
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

/** Earth catalog listing — header + colonist count + T/L/Q rows. Shown on
 * entry (landOnPlanet handler) and on '?'. The prompt itself lives in
 * `showEarthPrompt`. */
export function showEarthMenu(ctx: DisplayPlanetCtx, colonistsFuel: number) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.earthHeader, { count: colonistsFuel.toLocaleString() }));
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'T', text: 'Take colonists aboard' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'L', text: 'Leave colonists on planet' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave Earth' }));
}

/** Earth menu's renderPrompt — just the input prompt line. The catalog
 * listing isn't repeated after every action; '?' or re-entry prints it
 * via showEarthMenu. */
export function showEarthPrompt(ctx: DisplayPlanetCtx) {
    void ctx;
    // PLANET.prompt is currently shared with the regular planet menu.
    // When Earth diverges further (e.g. its own header colors) split it out.
    ctx.io.term.write(render(PLANET.prompt));
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
}

/** Catalog listing for the leave-colonists commodity pick. Prompt is
 * rendered by the askChar helper, not here. */
export function showPlanetLeaveCommodityMenu(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.leaveCommodityHeader));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showNoPlanet(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(SECTOR.noPlanet));
}
