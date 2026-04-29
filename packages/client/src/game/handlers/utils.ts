import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from '../types.js';

export type RefreshMinimapDeps = Pick<GameContext, 'io' | 'minimap'>;

export function fmt(n: number): string {
    return n.toLocaleString();
}

export function formatDuration(totalSeconds: number): string {
    if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
    const minutes = Math.round(totalSeconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.round(totalSeconds / 3600);
    if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const days = Math.round(totalSeconds / 86400);
    return `${days} day${days === 1 ? '' : 's'}`;
}

export function refreshMinimap(ctx: RefreshMinimapDeps): void {
    if (!ctx.minimap.handle) return;
    const vp = ctx.minimap.handle.getViewport();
    ctx.io.sendMsg({
        type: ClientMsgType.GetNeighborhood,
        halfWidthWorld: vp.halfWidthWorld,
        halfHeightWorld: vp.halfHeightWorld,
        centerXWorld: vp.centerXWorld,
        centerYWorld: vp.centerYWorld,
    });
}
