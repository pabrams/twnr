import { MAX_SHIP_NAME_LENGTH } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { askLineRaw } from './prompts.js';

type ShipNamePromptCtx = Pick<GameContext, 'io' | 'input' | 'player'>;

const DEFAULT_NAME_SUFFIX = "'s ship";

function defaultShipName(playerName: string): string {
    const stem = playerName
        .trim()
        .slice(0, MAX_SHIP_NAME_LENGTH - DEFAULT_NAME_SUFFIX.length)
        .trim();
    return stem === '' ? 'Unnamed ship' : `${stem}${DEFAULT_NAME_SUFFIX}`;
}

export async function promptShipName(
    ctx: ShipNamePromptCtx,
    promptTemplate: string,
    shipTypeDisplayName: string,
): Promise<string | null> {
    const fallback = defaultShipName(ctx.player.name);
    while (true) {
        const raw = await askLineRaw(
            ctx,
            render(promptTemplate, { type: shipTypeDisplayName, default: fallback }),
        );
        if (raw === null) return null;
        const name = raw.trim() === '' ? fallback : raw.trim();
        if (name.length > MAX_SHIP_NAME_LENGTH) {
            ctx.io.term.writeln(
                render(EVENT.shipNameInvalid, {
                    message: `Ship name too long (max ${MAX_SHIP_NAME_LENGTH}).`,
                }),
            );
            continue;
        }
        return name;
    }
}
