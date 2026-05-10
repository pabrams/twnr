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
        ['T', 'Take colonists aboard'],
        ['L', 'Leave colonists on planet'],
        ['G', 'Get commodity from planet'],
        ['P', 'Put commodity on planet'],
        ['D', 'Display Planet'],
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
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'D', text: 'Drone colonists' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showPlanetLeaveCommodityMenu(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.leaveCommodityHeader));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'D', text: 'Drones' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

/** Picker for the planet stockpile take/leave (the actual commodity, not
 *  colos assignments). Different header from the colos picker. */
export function showPlanetTakeStockpileMenu(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.takeStockpileHeader));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'D', text: 'Drones' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showPlanetLeaveStockpileMenu(ctx: DisplayPlanetCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.leaveStockpileHeader));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'F', text: 'Fuel' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'O', text: 'Organics' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'E', text: 'Equipment' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'D', text: 'Drones' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
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
