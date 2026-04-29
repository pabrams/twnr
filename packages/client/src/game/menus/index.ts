/**
 * Single import point for menu registrations. Importing this file pulls in
 * every per-menu module, each of which calls `registerMenu(...)` at import
 * time. After the strangler-fig migration is complete this is the only menu
 * wiring left in the codebase.
 *
 * Add new menus by creating a file in this directory and importing it here.
 */

export { registerMenu, getMenuHandler } from './types.js';
export type { MenuHandler } from './types.js';

// Per-menu registrations (alphabetical for stability).
import './attack.js';
import './attack-drones.js';
import './autopilot-prompt.js';
import './class0-qty.js';
import './computer.js';
import './deploy-drones-qty.js';
import './drone-attack-qty.js';
import './drone-encounter.js';
import './hyperspace-jump-target.js';
import './jettison-confirm.js';
import './known-universe.js';
import './planet-leave-qty.js';
import './planet-select.js';
import './planet-specs.js';
import './planet-take-qty.js';
import './quit-confirm.js';
import './ship-catalog.js';
import './shipyards-class0-qty.js';
import './starbase-buy-qty.js';
import './terraform-confirm.js';
import './trade-confirm.js';
import './trade-qty.js';
