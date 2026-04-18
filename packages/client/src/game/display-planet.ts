import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { PLANET, SECTOR, COMMON } from './messages/index.js';
import { showPrompt } from './display.js';

export function showPlanetMenu(ctx: GameContext, name: string, colonists: number) {
    ctx.term.writeln('');
    ctx.term.writeln(render(PLANET.landing, { name }));
    ctx.term.writeln(render(PLANET.colonists, { count: colonists.toLocaleString() }));
    showPlanetPrompt(ctx);
}

export function showPlanetMenuOptions(ctx: GameContext) {
    showPlanetPrompt(ctx);
}

export function showPlanetHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render(COMMON.menuRow, { key: 'T', text: 'Take colonists aboard' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'L', text: 'Leave colonists on planet' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'D', text: 'Planet Info' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Z', text: 'Destroy Planet' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave Planet' }));
    showPlanetPrompt(ctx);
}

function showPlanetPrompt(ctx: GameContext) {
    ctx.term.write(render(PLANET.prompt));
}

export function showEarthMenu(ctx: GameContext, colonistsFuel: number) {
    ctx.term.writeln('');
    ctx.term.writeln(render(PLANET.earthHeader, { count: colonistsFuel.toLocaleString() }));
    ctx.term.writeln('');
    ctx.term.writeln(render(COMMON.menuRow, { key: 'T', text: 'Take colonists aboard' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'L', text: 'Leave colonists on planet' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave Earth' }));
}

export function showPlanetTakePrompt(ctx: GameContext) {
    ctx.term.write(render(PLANET.takePrompt));
}

export function showPlanetLeavePrompt(ctx: GameContext) {
    ctx.term.write(render(PLANET.leavePrompt));
}

export function showPlanetTakeCommodityMenu(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render(PLANET.takeCommodityHeader));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel colonists' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics colonists' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment colonists' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showPlanetLeaveCommodityMenu(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render(PLANET.leaveCommodityHeader));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showNoPlanet(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render(SECTOR.noPlanet));
    showPrompt(ctx);
}
