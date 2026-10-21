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

// Vite HMR rebuilds the registry in place (preserving the WebSocket session): `{{ref}}`
// lookups update live, but direct imports of SECTOR.x etc. stay stale until page refresh.
if (import.meta.hot) {
    import.meta.hot.accept();
}
