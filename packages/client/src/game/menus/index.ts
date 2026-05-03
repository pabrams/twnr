/**
 * Single import point for menu registrations. Importing this file pulls in
 * every per-menu module, each of which calls `registerMenu(...)` at import
 * time.
 *
 * Add new menus by creating a file in this directory and importing it here.
 */

export { registerMenu, getMenuHandler, registerRoutine, getRoutine } from './types.js';
export type { MenuHandler, ClientRoutine } from './types.js';

import './common-routines.js';
import './attack.js';
import './attack-drones.js';
import './autopilot-prompt.js';
import './class0.js';
import './class0-qty.js';
import './computer.js';
import './deploy-drones-qty.js';
import './drone-attack-qty.js';
import './drone-encounter.js';
import './hyperspace-jump-target.js';
import './jettison-confirm.js';
import './known-universe.js';
import './move.js';
import './planet.js';
import './planet-earth.js';
import './planet-leave-commodity.js';
import './planet-leave-qty.js';
import './planet-select.js';
import './planet-specs.js';
import './planet-take-commodity.js';
import './planet-take-qty.js';
import './port.js';
import './quit-confirm.js';
import './sector.js';
import './ship-catalog.js';
import './shipyards.js';
import './shipyards-buy.js';
import './shipyards-class0.js';
import './shipyards-class0-qty.js';
import './shipyards-examine.js';
import './shipyards-tradein.js';
import './starbase.js';
import './starbase-buy-qty.js';
import './starbase-hardware.js';
import './deploy-mines.js';
import './deploy-mines-qty.js';
import './mine-disruptor-target.js';
import './terraform-confirm.js';
import './trade-confirm.js';
import './trade-qty.js';
