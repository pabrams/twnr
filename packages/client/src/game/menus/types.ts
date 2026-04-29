import type { MenuName } from '@twnr/shared';
import type { GameContext } from '../types.js';

/**
 * Per-menu behavior bundle. Each menu lives in its own file under `menus/`
 * and registers an instance of this with `registerMenu`. The dispatchers in
 * input.ts and connection.ts consult `menuHandlers` first; if a menu hasn't
 * been migrated yet the legacy switches in those files run instead.
 *
 * Both fields are optional so a menu can opt into just one side of the
 * lifecycle (e.g. a confirm-prompt only handles input; a result-driven
 * display-only menu only renders).
 */
export interface MenuHandler {
    /** Process a submitted input line for this menu. */
    input?: (ctx: GameContext, line: string) => void;
    /** Render the menu's prompt/screen when entered via MenuChanged. */
    enter?: (ctx: GameContext) => void;
}

const menuHandlers = new Map<MenuName, MenuHandler>();

export function registerMenu(name: MenuName, handler: MenuHandler): void {
    menuHandlers.set(name, handler);
}

export function getMenuHandler(name: MenuName): MenuHandler | undefined {
    return menuHandlers.get(name);
}
