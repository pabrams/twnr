/**
 * Single import point for routine registrations. Importing this file pulls
 * in every routine module, each of which calls `registerRoutine` /
 * `registerMenuRoutine` at import time. Menu identity + prompt renderers
 * are now declared in `../menu-registry.ts`; this file is purely about the
 * implementations.
 */

export {
    registerMenu,
    getMenuHandler,
    registerRoutine,
    registerMenuRoutine,
    getRoutine,
    showPrompt,
} from './types.js';
export type { MenuHandler, ClientRoutine } from './types.js';

import './common-routines.js';
import './sector-routines.js';
import './shipyards-routines.js';
import './starbase-routines.js';
import './combat-routines.js';
import './computer-routines.js';
import './planet-routines.js';
import './clan-routines.js';
import './drone-encounter-routines.js';
import './planet-earth-routines.js';
import './hardware-routines.js';
