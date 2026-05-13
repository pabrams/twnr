import type { GameContext } from '../types.js';
import { showSectorDisplay, type DisplayCtx } from '../display.js';
import type { Handler } from './index.js';
import { refreshMinimap, type RefreshMinimapCtx } from './utils.js';

type SectorContext = Pick<GameContext, 'io' | 'world'> & DisplayCtx & RefreshMinimapCtx;

export const sectorDisplay: Handler<'sectorDisplayResult', SectorContext> = (ctx, msg) => {
    ctx.world.sectorPlayers = msg.players;
    showSectorDisplay(ctx, msg);
    refreshMinimap(ctx);
};
