import { Menu } from '@twnr/shared';
import { showKnownUniverseMenu } from '../display-computer.js';
import { registerMenu } from './types.js';

// Known Universe menu — fully migrated. The explored_sectors and
// unexplored_sectors routines (in computer-routines.ts) render locally
// from cached state. Back is in common-routines.ts.
registerMenu(Menu.KnownUniverse, {
    renderPrompt: showKnownUniverseMenu,
});
