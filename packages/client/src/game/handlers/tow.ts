import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import type { EventHandler } from './index.js';

export const towReleasedAlert: EventHandler<'TowReleasedAlert'> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.towReleasedAlert, { name: msg.towedName }));
};

export const towAttachedAlert: EventHandler<'TowAttachedAlert'> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.towAttachedAlert, { name: msg.towingName }));
};
