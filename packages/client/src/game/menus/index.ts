/**
 * Single import point for menu registrations. Importing this file pulls in
 * every per-menu module, each of which calls `registerMenu(...)` at import
 * time.
 *
 * Add new menus by creating a file in this directory and importing it here.
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
import './port-routines.js';
import './shipyards-routines.js';
import './combat-routines.js';
import './computer-routines.js';
import './planet-routines.js';
import './move-routines.js';
import './attack.js';
import './autopilot-prompt.js';
import './class0.js';
import './computer.js';
import './deploy-drones-qty.js';
import './drone-encounter.js';
import './known-universe.js';
import './move.js';
import './planet.js';
import './planet-earth.js';
import './planet-select.js';
import './planet-specs.js';
import './port.js';
import './sector.js';
import './ship-catalog.js';
import './shipyards.js';
import './shipyards-buy.js';
import './shipyards-class0.js';
import './shipyards-examine.js';
import './starbase.js';
import './starbase-hardware.js';
