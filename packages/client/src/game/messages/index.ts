import { registerTemplates, clearRegistry } from '../renderer.js';
import { MSG } from '../messages.js';
import { COMMON } from './common.js';
import { SECTOR } from './sector.js';
import { HELP, HELP_LINES } from './help.js';
import { PORT } from './port.js';
import { PLANET } from './planet.js';
import { STARBASE } from './starbase.js';
import { COMPUTER } from './computer.js';
import { COMBAT } from './combat.js';
import { NOTIFY } from './notifications.js';
import { TRANSACTION } from './transactions.js';
import { EVENT } from './events.js';
import { PANEL } from './panels.js';
import { COMMAND } from './commands.js';
import { CLAN } from './clan.js';
import { NEWS, NEWS_EVENT } from './news.js';

export {
    MSG,
    COMMON,
    SECTOR,
    HELP,
    HELP_LINES,
    PORT,
    PLANET,
    STARBASE,
    COMPUTER,
    COMBAT,
    NOTIFY,
    TRANSACTION,
    EVENT,
    PANEL,
    COMMAND,
    CLAN,
    NEWS,
    NEWS_EVENT,
};

/** Registration order matters for bare-key collisions (first wins); MSG registers first as the default. */
function buildAndRegister() {
    clearRegistry();
    const DOMAINS = {
        MSG,
        COMMON,
        SECTOR,
        HELP,
        PORT,
        PLANET,
        STARBASE,
        COMPUTER,
        COMBAT,
        NOTIFY,
        TRANSACTION,
        EVENT,
        PANEL,
        COMMAND,
        CLAN,
        NEWS,
        NEWS_EVENT,
    };
    const flat: Record<string, string> = {};
    for (const [domain, group] of Object.entries(DOMAINS)) {
        for (const [key, tpl] of Object.entries(group)) {
            flat[`${domain}.${key}`] = tpl as string;
        }
    }
    registerTemplates(flat);
}

buildAndRegister();

// Self-accept HMR so template edits don't drop the WebSocket session.
if (import.meta.hot) {
    import.meta.hot.accept();
}
