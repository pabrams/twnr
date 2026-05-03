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
    /** Process a submitted input line for this menu. May be async (e.g.
     * a handler that uses askChar/askNumber). The framework awaits the
     * returned promise before deciding whether to auto-render the
     * prompt — so a routine that ends with no roundtrip and no
     * sub-prompt gets the prompt re-rendered for free. */
    input?: (ctx: GameContext, line: string) => void | Promise<void>;
    /**
     * Paint the menu's prompt/screen when the server replies with a pure
     * menu-transition envelope (no payload). Not called when a content
     * result handler renders the menu itself — those handlers paint the
     * full screen including the prompt.
     */
    renderPrompt?: (ctx: GameContext) => void;
    /**
     * Client-driven menus (no `menu_command` rows) opt into key filtering
     * by declaring this. `isValidKeyForMenu` calls it before accepting
     * the keystroke; if it returns false the key is silently dropped
     * (no stranded linefeed). Without it, every key is accepted (the
     * permissive fallback) — fine for "WIP catch all input" style
     * menus, bad for production UX.
     */
    acceptsKey?: (key: string) => boolean;
}

const menuHandlers = new Map<MenuName, MenuHandler>();

export function registerMenu(name: MenuName, handler: MenuHandler): void {
    menuHandlers.set(name, handler);
}

export function getMenuHandler(name: MenuName): MenuHandler | undefined {
    return menuHandlers.get(name);
}

/**
 * Render the current menu's prompt. One indirection — every caller that
 * wants to "show the prompt for wherever the user is now" goes through
 * here. The framework auto-fires it after server envelopes; routines /
 * handlers that finish a fully client-side action (no server roundtrip)
 * call it explicitly so the prompt reappears before the next keystroke.
 */
export function showPrompt(ctx: GameContext): void {
    menuHandlers.get(ctx.world.mode)?.renderPrompt?.(ctx);
}

/**
 * A client routine is the local behavior triggered when a menu_command's
 * key is pressed. Receives the GameContext plus the raw input line (so
 * `<number>`/`<letter>` routines can parse it). Routines are async to
 * support multi-step prompts via input helpers in `prompts.ts`.
 *
 * Routines are looked up by `command.name` (from the menu_command table).
 * Most commands are unique site-wide (e.g. `back`, `quit_game`,
 * `shipyards_menu`) and a single routine fires regardless of which menu
 * triggered them. A few command names are reused across menus with
 * different semantics — most commonly `enter_quantity`. For those,
 * register a menu-scoped routine via `registerMenuRoutine(menu, command,
 * fn)`; the dispatcher prefers menu-scoped routines over global ones.
 */
export type ClientRoutine = (ctx: GameContext, line: string) => void | Promise<void>;

const routines = new Map<string, ClientRoutine>();
const menuRoutines = new Map<string, ClientRoutine>();

const menuKey = (menu: string, command: string) => `${menu}::${command}`;

export function registerRoutine(commandName: string, routine: ClientRoutine): void {
    routines.set(commandName, routine);
}

export function registerMenuRoutine(
    menu: MenuName,
    commandName: string,
    routine: ClientRoutine,
): void {
    menuRoutines.set(menuKey(menu, commandName), routine);
}

export function getRoutine(menu: MenuName, commandName: string): ClientRoutine | undefined {
    return menuRoutines.get(menuKey(menu, commandName)) ?? routines.get(commandName);
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
