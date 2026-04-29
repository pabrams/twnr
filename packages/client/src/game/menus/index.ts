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
import './autopilot-prompt.js';
import './jettison-confirm.js';
import './quit-confirm.js';
import './terraform-confirm.js';
