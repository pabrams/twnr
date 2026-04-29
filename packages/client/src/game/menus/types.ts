import type { MenuName } from '@twnr/shared';
import type { GameContext, MenuArgs } from '../types.js';

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
    /**
     * Paint the menu's prompt/screen when the server replies with a pure
     * menu-transition envelope (no payload). Not called when a content
     * result handler renders the menu itself — those handlers paint the
     * full screen including the prompt.
     */
    renderPrompt?: (ctx: GameContext) => void;
}

const menuHandlers = new Map<MenuName, MenuHandler>();

export function registerMenu(name: MenuName, handler: MenuHandler): void {
    menuHandlers.set(name, handler);
}

export function getMenuHandler(name: MenuName): MenuHandler | undefined {
    return menuHandlers.get(name);
}

export type MenuArgsSlot = Pick<GameContext, 'pendingMenuArgs'>;

/**
 * Stash typed args for the next menu. Source menu calls this before sending
 * `ChangeMenu`; the destination menu's `renderPrompt`/`input` reads it via
 * `getMenuArgs`. The discriminated union ensures each side sees the right
 * shape.
 */
export function setMenuArgs(ctx: MenuArgsSlot, args: MenuArgs): void {
    ctx.pendingMenuArgs = args;
}

/**
 * Read the pending args for the destination menu without clearing them.
 * Args persist (so both `renderPrompt` and `input` can read) until the next
 * `setMenuArgs` call overwrites them. Returns null if the slot is empty or
 * holds args for a different menu — defensive against state drift.
 */
export function getMenuArgs<M extends MenuArgs['menu']>(
    ctx: MenuArgsSlot,
    menu: M,
): Extract<MenuArgs, { menu: M }> | null {
    const args = ctx.pendingMenuArgs;
    if (args && args.menu === menu) {
        return args as Extract<MenuArgs, { menu: M }>;
    }
    return null;
}
