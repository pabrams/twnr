import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import type { Handler } from './index.js';

export const towReleasedAlert: Handler<'towReleasedAlert'> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.towReleasedAlert, { name: msg.towedName }));
};

export const towAttachedAlert: Handler<'towAttachedAlert'> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.towAttachedAlert, { name: msg.towingName }));
};
