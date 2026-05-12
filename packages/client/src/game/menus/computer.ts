import { ClientTag, Menu } from '@twnr/shared';
import { showComputerPrompt } from '../display-computer.js';
import { registerMenu, getRoutine } from './types.js';

const KEY_TO_COMMAND: Record<string, string> = {
    k: 'known_universe',
    l: 'trader_list',
    c: 'ship_catalog',
    j: 'planet_specs',
    ';': 'current_ship_specs',
    '?': 'help_menu',
    d: 'list_deployed_drones',
    h: 'hyperspace_jump',
    y: 'list_planets',
    m: 'track_seeker_mines',
    z: 'active_ship_scan',
    o: 'change_ship_ownership',
};

const VALID_KEYS = new Set([...Object.keys(KEY_TO_COMMAND), 'q']);

registerMenu(Menu.Computer, {
    renderPrompt: showComputerPrompt,
    acceptsKey: (key) => VALID_KEYS.has(key.toLowerCase()),
    input(ctx, line) {
        if (line === '') return;
        const key = line.toLowerCase();
        if (key === 'q') {
            ctx.world.mode = Menu.Sector;
            ctx.io.sendMsg({ type: ClientTag.SectorDisplay });
            return;
        }
        const cmd = KEY_TO_COMMAND[key];
        if (!cmd) return;
        return getRoutine(ctx.world.mode, cmd)?.(ctx, line);
    },
});
