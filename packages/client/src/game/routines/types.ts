import type { MenuName } from '@twnr/shared';
import type { GameContext, MenuArgs } from '../types.js';

export interface MenuHandler {
    renderPrompt?: (ctx: GameContext) => void;
    acceptsKey?: (key: string) => boolean;
}

const menuHandlers = new Map<MenuName, MenuHandler>();

export function registerMenu(name: MenuName, handler: MenuHandler): void {
    menuHandlers.set(name, handler);
}

export function getMenuHandler(name: MenuName): MenuHandler | undefined {
    return menuHandlers.get(name);
}

export function showPrompt(ctx: GameContext): void {
    menuHandlers.get(ctx.world.mode)?.renderPrompt?.(ctx);
}

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

export function setMenuArgs(ctx: MenuArgsSlot, args: MenuArgs): void {
    ctx.pendingMenuArgs = args;
}

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
