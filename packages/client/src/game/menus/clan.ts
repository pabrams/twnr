import { Menu } from '@twnr/shared';
import { showClanPrompt } from '../display-clan.js';
import { registerMenu, getRoutine } from './types.js';

const KEY_TO_COMMAND: Record<string, string> = {
    d: 'clan_display_list',
    i: 'clan_display_info',
    m: 'clan_make',
    j: 'clan_join',
    x: 'clan_leave',
    '?': 'clan_help',
};

const VALID_KEYS = new Set([...Object.keys(KEY_TO_COMMAND), 'q']);

registerMenu(Menu.Clan, {
    renderPrompt: showClanPrompt,
    acceptsKey: (key) => VALID_KEYS.has(key.toLowerCase()),
    input(ctx, line) {
        if (line === '') return;
        const key = line.toLowerCase();
        if (key === 'q') {
            ctx.world.mode = Menu.Sector;
            return;
        }
        const cmd = KEY_TO_COMMAND[key];
        if (!cmd) return;
        return getRoutine(ctx.world.mode, cmd)?.(ctx, line);
    },
});
