import { ClientTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import type { GameContext } from '../types.js';

export type RefreshMinimapCtx = Pick<GameContext, 'io' | 'minimap'>;

export function fmt(n: number): string {
    return n.toLocaleString();
}

/** Use M for millions */
export function fmtCompact(n: number): string {
    if (n >= 10_000_000) {
        return `${(n / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
    }
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

export function renderAttributeChange(
    ctx: Pick<GameContext, 'io'>,
    expDelta: number,
    repDelta: number,
    reason: string,
): void {
    if (expDelta === 0 && repDelta === 0) return;
    if (expDelta !== 0) {
        ctx.io.term.writeln(
            render(expDelta > 0 ? EVENT.expGained : EVENT.expLost, {
                amount: Math.abs(expDelta),
            }),
        );
    }
    if (repDelta !== 0) {
        ctx.io.term.writeln(
            render(repDelta > 0 ? EVENT.alignmentUp : EVENT.alignmentDown, {
                amount: Math.abs(repDelta),
                reason,
            }),
        );
    }
}

export function refreshMinimap(ctx: RefreshMinimapCtx): void {
    if (!ctx.minimap.handle) return;
    const vp = ctx.minimap.handle.getViewport();
    ctx.io.sendMsg(
        {
            type: ClientTag.GetNeighborhood,
            halfWidthWorld: vp.halfWidthWorld,
            halfHeightWorld: vp.halfHeightWorld,
            centerXWorld: vp.centerXWorld,
            centerYWorld: vp.centerYWorld,
        },
        { silent: true },
    );
}
