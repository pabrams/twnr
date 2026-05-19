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
    const lines = [
        ['S', 'Load/Unload Colonists'],
        ['T', 'Take or Leave Product'],
        ['P', 'Change Population Lvls'],
        ['D', 'Display Planet'],
        ['O', 'Claim Planet'],
        ['B', 'Planetary Defense Bastion'],
        ['Z', 'Try to Destroy Planet'],
        ['', ''],
        ['Q', 'Leave this Planet'],
    ];
    const inner = 30;
    const top = '╔' + '═'.repeat(inner + 2) + '╗';
    const bot = '╚' + '═'.repeat(inner + 2) + '╝';
    ctx.io.term.writeln('');
    ctx.io.term.writeln(top);
    for (const [key, text] of lines) {
        let body: string;
        if (!key && !text) {
            body = ' '.repeat(inner);
        } else {
            const left = `<${key}> ${text}`;
            body = left.padEnd(inner, ' ');
        }
        ctx.io.term.writeln(`║ ${body} ║`);
    }
    ctx.io.term.writeln(bot);
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

export function showEarthPrompt(ctx: DisplayPlanetCtx) {
    void ctx;
    ctx.io.term.write(render(PLANET.prompt));
}

export function showNoPlanet(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(SECTOR.noPlanet));
}

export function showPlanetSelectMenu(
    ctx: DisplayPlanetCtx,
    planets: { id: number; name: string; type: string; displayType: string | null }[],
) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.planetSelectHeader));
    ctx.io.term.writeln(render(PLANET.planetSelectSep));
    planets.forEach((p, i) => {
        ctx.io.term.writeln(
            render(PLANET.planetSelectRow, {
                n: String(i + 1).padStart(4, ' '),
                name: p.name,
            }),
        );
    });
}
