import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, EVENT, SECTOR } from '../messages/index.js';
import { registerMenu, registerMenuRoutine, getMenuArgs } from './types.js';

registerMenu(Menu.AutopilotPrompt, {
    renderPrompt(ctx) {
        const args = getMenuArgs(ctx, Menu.AutopilotPrompt);
        const { term } = ctx.io;
        if (args) {
            ctx.autopilot.path = args.path.map((p) => p.sector);
            ctx.autopilot.step = 0;
            const from = args.path[0]?.sector ?? 0;
            const to = args.path[args.path.length - 1]?.sector ?? 0;
            term.writeln('');
            term.writeln(
                render(SECTOR.autopilotNotAdjacent, {
                    hops: args.hops,
                    turns: args.turns,
                    from,
                    to,
                }),
            );
            const sep = render(SECTOR.autopilotPathSeparator);
            const list = args.path
                .map((p) => {
                    const tpl = p.visited ? SECTOR.warpVisited : SECTOR.warpUnvisited;
                    return render(tpl, { sector: p.sector });
                })
                .join(sep);
            term.writeln(`  ${list}`);
        }
        term.write(render(SECTOR.autopilotConfirm));
    },
});

registerMenuRoutine(Menu.AutopilotPrompt, 'confirm_yes', (ctx) => {
    ctx.io.term.writeln(render(NOTIFY.autopilotEngaged));
    const nextSector = ctx.autopilot.path[1];
    ctx.autopilot.step = 2;
    ctx.io.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
    ctx.io.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
});

registerMenuRoutine(Menu.AutopilotPrompt, 'confirm_no', (ctx) => {
    ctx.autopilot.path = [];
    ctx.autopilot.step = 0;
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Sector });
});
