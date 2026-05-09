import { Menu } from '@twnr/shared';
import { showComputerPrompt } from '../display-computer.js';
import { registerMenu, getRoutine } from './types.js';

const KEY_TO_COMMAND: Record<string, string> = {
    k: 'known_universe',
    l: 'trader_list',
    c: 'ship_catalog',
    j: 'planet_specs',
    ';': 'current_ship_specs',
    '?': 'help_menu',
    q: 'back',
    d: 'list_deployed_drones',
    h: 'hyperspace_jump',
    y: 'list_planets',
    m: 'track_seeker_mines',
};

const VALID_KEYS = new Set(Object.keys(KEY_TO_COMMAND));

registerMenu(Menu.Computer, {
    renderPrompt: showComputerPrompt,
    acceptsKey: (key) => VALID_KEYS.has(key.toLowerCase()),
    input(ctx, line) {
        if (line === '') return;
        const cmd = KEY_TO_COMMAND[line.toLowerCase()];
        if (!cmd) return;
        return getRoutine(ctx.world.mode, cmd)?.(ctx, line);
    },
});
