/**
 * Port haggle session handlers.
 *
 * In-memory session is keyed by playerId — only one haggle in flight per
 * player. The session is replaced if the player opens a new one and cleared
 * on undock / WS disconnect / timeout. The trade only commits on `accept`,
 * so quitting mid-haggle is free (no credits move, no cargo moves).
 *
 * Rejection ("This conversation is terminated!") deducts one turn — same
 * cost as a successful buy under the TW2002 reference — so spamming
 * aggressive counters has a price.
 */

import {
    ServerTag,
    PORT_CLASS_ACTIONS,
    computeUnitPriceWithXp,
    processHaggleCounter,
    rollMidHaggleRounds,
    type PriceCommodity,
    type PortAction,
} from '@twnr/shared';
import type { HaggleOpenCommand, HaggleCounterCommand } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { withTransaction, AbortTransaction } from '../db/index.js';
import {
    deductCredits,
    addCredits,
    getCurrentSector,
    adjustReputationAndExperience,
} from '../db/queries/player.js';
import {
    getPortTradeInfoForUpdate,
    adjustPortCommodity,
    type Commodity,
} from '../db/queries/port.js';
import {
    getShipCargoWithCreditsForUpdate,
    incrementShipCommodity,
} from '../db/queries/ship.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { cargoUsed, formatCargo } from './cargo-utils.js';
import { recordCreditChange } from '../services/audit.js';
import { notifyAttributeChange, notifyTurnChange } from '../services/notify.js';
import { experienceDeltas } from '../game-config.js';

type HaggleSession = {
    playerId: number;
    sectorNumber: number;
    universeId: number;
    commodity: PriceCommodity;
    action: 'buy' | 'sell';
    /** Port-side action for math (B if player sells, S if player buys). */
    portAction: PortAction;
    quantity: number;
    mcic: number;
    portClass: number;
    initialOffer: number;
    portCurrent: number;
    midRoundsLeft: number;
    isFinalIssued: boolean;
    openedAt: number;
};

const sessions = new Map<number, HaggleSession>();

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

const MAX_COL: Record<Commodity, 'fuel_max' | 'org_max' | 'equ_max'> = {
    fuel: 'fuel_max',
    organics: 'org_max',
    equipment: 'equ_max',
};
const MCIC_COL: Record<Commodity, 'fuel_mcic' | 'org_mcic' | 'equ_mcic'> = {
    fuel: 'fuel_mcic',
    organics: 'org_mcic',
    equipment: 'equ_mcic',
};

/** Clear any active session for the player. Called on Undock, WS disconnect,
 *  and when starting a new session. */
export function clearHaggleSession(playerId: number): void {
    sessions.delete(playerId);
}

function getActiveSession(playerId: number): HaggleSession | null {
    const s = sessions.get(playerId);
    if (!s) return null;
    if (Date.now() - s.openedAt > SESSION_TIMEOUT_MS) {
        sessions.delete(playerId);
        return null;
    }
    return s;
}

export async function serveHaggleOpen(playerId: number, data: HaggleOpenCommand): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (data.commodity !== 'fuel' && data.commodity !== 'organics' && data.commodity !== 'equipment') {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleOpenResult,
            outcome: 'error',
            message: 'Invalid commodity',
        });
        return;
    }
    if (data.action !== 'buy' && data.action !== 'sell') {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleOpenResult,
            outcome: 'error',
            message: 'Invalid action',
        });
        return;
    }
    const qty = Number.isInteger(data.quantity) ? data.quantity : parseInt(String(data.quantity), 10);
    if (isNaN(qty) || qty <= 0) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleOpenResult,
            outcome: 'error',
            message: 'Invalid quantity',
        });
        return;
    }

    const col = data.commodity as Commodity;

    // Lock the port + read current state + player xp for the initial price.
    const port = await getPortTradeInfoForUpdate(player.sector, player.universeId);
    if (!port) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleOpenResult,
            outcome: 'error',
            message: 'No port in this sector',
        });
        return;
    }
    const actions = PORT_CLASS_ACTIONS[port.class];
    if (
        !actions ||
        (data.action === 'buy' && actions[col] !== 'S') ||
        (data.action === 'sell' && actions[col] !== 'B')
    ) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleOpenResult,
            outcome: 'error',
            message: 'Port does not trade this commodity',
        });
        return;
    }

    // Quantity must fit the port side: buying caps to current stock, selling
    // caps to remaining buying capacity (max - stock).
    const stock = port[col];
    const max = port[MAX_COL[col]];
    const mcic = port[MCIC_COL[col]];
    if (data.action === 'buy' && qty > stock) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleOpenResult,
            outcome: 'error',
            message: 'Port does not have that much to sell',
        });
        return;
    }
    if (data.action === 'sell' && qty > max - stock) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleOpenResult,
            outcome: 'error',
            message: 'Port cannot buy that many',
        });
        return;
    }

    // Snapshot xp for the initial unit price (no further xp reads until
    // accept, so pricing stays stable across rounds).
    const player_ = players[playerId];
    if (!player_) return;
    const xp = await (async () => {
        const { pool } = await import('../db/index.js');
        const res = await pool.query<{ experience: number }>(
            'SELECT experience FROM players WHERE id = $1',
            [playerId],
        );
        return res.rows[0]?.experience ?? 0;
    })();

    const portAction = actions[col];
    const unitPrice = computeUnitPriceWithXp(col, stock, max, mcic, xp, portAction);
    const initialOffer = unitPrice * qty;

    sessions.set(playerId, {
        playerId,
        sectorNumber: player.sector,
        universeId: player.universeId,
        commodity: col,
        action: data.action,
        portAction,
        quantity: qty,
        mcic,
        portClass: port.class,
        initialOffer,
        portCurrent: initialOffer,
        midRoundsLeft: rollMidHaggleRounds(),
        isFinalIssued: false,
        openedAt: Date.now(),
    });

    sendEnvelope(playerId, {
        type: ServerTag.HaggleOpenResult,
        outcome: 'opened',
        commodity: col,
        action: data.action,
        quantity: qty,
        initialOffer,
    });
}

export async function serveHaggleCounter(
    playerId: number,
    data: HaggleCounterCommand,
): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const session = getActiveSession(playerId);
    if (!session) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'error',
            message: 'No active haggle session',
        });
        return;
    }
    if (session.isFinalIssued) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'error',
            message: 'Final offer issued — accept or quit',
        });
        return;
    }
    const counter = Number.isFinite(data.counter)
        ? Math.floor(data.counter)
        : parseInt(String(data.counter), 10);
    if (!Number.isFinite(counter) || counter <= 0) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'error',
            message: 'Invalid counter',
        });
        return;
    }

    const step = processHaggleCounter({
        action: session.portAction,
        commodity: session.commodity,
        mcic: session.mcic,
        initialOffer: session.initialOffer,
        portCurrent: session.portCurrent,
        playerCounter: counter,
        midRoundsLeft: session.midRoundsLeft,
    });

    if (step.outcome === 'reject') {
        // Conversation terminated → deduct 1 turn, clear session.
        clearHaggleSession(playerId);
        let turnsUsed: number | undefined;
        try {
            await withTransaction(async (client) => {
                const turn = await checkAndDeductTurns(playerId, session.universeId, 1, client);
                if (turn.allowed) turnsUsed = turn.turnsUsed;
            });
        } catch (err) {
            console.error('Haggle reject turn deduction failed', err);
        }
        if (turnsUsed) notifyTurnChange(playerId, turnsUsed, 'rejected haggle');
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'rejected',
            message: 'This conversation is terminated!',
            ...(turnsUsed !== undefined ? { turnsUsed } : {}),
        });
        return;
    }

    if (step.outcome === 'counter') {
        session.portCurrent = step.newPortOffer;
        session.midRoundsLeft = step.midRoundsLeft;
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'counter',
            newPortOffer: step.newPortOffer,
        });
        return;
    }

    if (step.outcome === 'final') {
        session.portCurrent = step.newPortOffer;
        session.isFinalIssued = true;
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'final',
            newPortOffer: step.newPortOffer,
        });
        return;
    }

    // accept — settle the trade at `step.finalTotal`.
    await settleTrade(playerId, session, step.finalTotal);
}

export async function serveHaggleAccept(playerId: number): Promise<void> {
    const session = getActiveSession(playerId);
    if (!session) {
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'error',
            message: 'No active haggle session',
        });
        return;
    }
    await settleTrade(playerId, session, session.portCurrent);
}

export function serveHaggleQuit(playerId: number): void {
    clearHaggleSession(playerId);
}

async function settleTrade(
    playerId: number,
    session: HaggleSession,
    agreedTotal: number,
): Promise<void> {
    try {
        const result = await withTransaction(async (client) => {
            // Re-fetch current sector / port under lock (avoid stale).
            const currentSector = await getCurrentSector(playerId, client);
            if (currentSector !== session.sectorNumber) {
                sendEnvelope(playerId, {
                    type: ServerTag.HaggleResponseResult,
                    outcome: 'error',
                    message: 'You moved — haggle cancelled',
                });
                clearHaggleSession(playerId);
                throw new AbortTransaction();
            }
            const port = await getPortTradeInfoForUpdate(
                session.sectorNumber,
                session.universeId,
                client,
            );
            if (!port) {
                sendEnvelope(playerId, {
                    type: ServerTag.HaggleResponseResult,
                    outcome: 'error',
                    message: 'No port in this sector',
                });
                clearHaggleSession(playerId);
                throw new AbortTransaction();
            }

            const col = session.commodity as Commodity;
            const stock = port[col];
            const max = port[MAX_COL[col]];
            const cargo = await getShipCargoWithCreditsForUpdate(playerId, client);
            if (!cargo) {
                sendEnvelope(playerId, {
                    type: ServerTag.HaggleResponseResult,
                    outcome: 'error',
                    message: 'Player not found',
                });
                clearHaggleSession(playerId);
                throw new AbortTransaction();
            }

            let turnsUsed: number | undefined;
            if (session.action === 'buy') {
                const turn = await checkAndDeductTurns(playerId, session.universeId, 1, client);
                if (!turn.allowed) {
                    sendEnvelope(playerId, {
                        type: ServerTag.HaggleResponseResult,
                        outcome: 'error',
                        message: 'Insufficient turns',
                    });
                    throw new AbortTransaction();
                }
                turnsUsed = turn.turnsUsed;

                if (cargo.credits < agreedTotal) {
                    sendEnvelope(playerId, {
                        type: ServerTag.HaggleResponseResult,
                        outcome: 'error',
                        message: 'Insufficient credits',
                    });
                    throw new AbortTransaction();
                }
                if (stock < session.quantity) {
                    sendEnvelope(playerId, {
                        type: ServerTag.HaggleResponseResult,
                        outcome: 'error',
                        message: 'Port stock changed mid-haggle',
                    });
                    clearHaggleSession(playerId);
                    throw new AbortTransaction();
                }
                if (cargoUsed(cargo) + session.quantity > cargo.cargo_limit) {
                    sendEnvelope(playerId, {
                        type: ServerTag.HaggleResponseResult,
                        outcome: 'error',
                        message: 'Insufficient cargo holds',
                    });
                    throw new AbortTransaction();
                }

                await adjustPortCommodity(port.port_id, col, -session.quantity, client);
                await incrementShipCommodity(playerId, col, session.quantity, client);
                await deductCredits(playerId, agreedTotal, client);
                await recordCreditChange(client, {
                    playerId,
                    actionType: 'port_buy',
                    delta: -agreedTotal,
                    prevCredits: cargo.credits,
                    newCredits: cargo.credits - agreedTotal,
                    context: {
                        sector: session.sectorNumber,
                        commodity: col,
                        qty: session.quantity,
                        agreedTotal,
                        portClass: session.portClass,
                        haggle: true,
                    },
                });
                cargo[col] += session.quantity;
                cargo.credits -= agreedTotal;
            } else {
                // sell
                if (cargo[col] < session.quantity) {
                    sendEnvelope(playerId, {
                        type: ServerTag.HaggleResponseResult,
                        outcome: 'error',
                        message: 'Insufficient cargo',
                    });
                    throw new AbortTransaction();
                }
                if (stock + session.quantity > max) {
                    sendEnvelope(playerId, {
                        type: ServerTag.HaggleResponseResult,
                        outcome: 'error',
                        message: 'Port capacity changed mid-haggle',
                    });
                    clearHaggleSession(playerId);
                    throw new AbortTransaction();
                }

                await adjustPortCommodity(port.port_id, col, session.quantity, client);
                await incrementShipCommodity(playerId, col, -session.quantity, client);
                await addCredits(playerId, agreedTotal, client);
                await recordCreditChange(client, {
                    playerId,
                    actionType: 'port_sell',
                    delta: agreedTotal,
                    prevCredits: cargo.credits,
                    newCredits: cargo.credits + agreedTotal,
                    context: {
                        sector: session.sectorNumber,
                        commodity: col,
                        qty: session.quantity,
                        agreedTotal,
                        portClass: session.portClass,
                        haggle: true,
                    },
                });
                cargo[col] -= session.quantity;
                cargo.credits += agreedTotal;
            }

            const xpDelta = experienceDeltas.amountChangeFor.portTrade ?? 0;
            if (xpDelta !== 0) {
                await adjustReputationAndExperience(playerId, 0, xpDelta, client);
            }

            const used = cargoUsed(cargo);
            return {
                finalTotal: agreedTotal,
                credits: cargo.credits,
                cargo: formatCargo(cargo),
                emptyHolds: Math.max(0, cargo.cargo_limit - used),
                turnsUsed,
                experienceGained: xpDelta,
            };
        });

        if (!result) return;
        clearHaggleSession(playerId);
        notifyAttributeChange(playerId, 0, result.experienceGained ?? 0, 'trading');
        if (result.turnsUsed) notifyTurnChange(playerId, result.turnsUsed, 'trading');
        sendEnvelope(playerId, {
            type: ServerTag.HaggleResponseResult,
            outcome: 'accepted',
            ...result,
        });
    } catch (err) {
        if (err instanceof AbortTransaction) return;
        console.error('Haggle settle error', err);
        sendError(playerId, 'Internal server error');
    }
}
