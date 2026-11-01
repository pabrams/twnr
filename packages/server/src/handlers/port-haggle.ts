import {
    PORT_CLASS_ACTIONS,
    computeUnitPriceWithXp,
    processHaggleCounter,
    rollMidHaggleRounds,
    type PriceCommodity,
    type PortAction,
} from '@twnr/shared';
import type { CommandRequest } from '@twnr/shared';
import { requireOnlinePlayer } from '../state/players.js';
import { withTransaction } from '../db/index.js';

import {
    deductCredits,
    addCredits,
    getCurrentSector,
    adjustReputationAndExperience,
    getPlayerExperience,
} from '../db/queries/player.js';
import {
    getPortTradeInfoForUpdate,
    adjustPortCommodity,
    type Commodity,
} from '../db/queries/port.js';
import { getShipCargoWithCreditsForUpdate, incrementShipCommodity } from '../db/queries/ship.js';
import { checkAndDeductTurns } from '../turn-logic.js';
import { cargoUsed, formatCargo } from './cargo-utils.js';
import { notifyTurnChange } from '../services/notify.js';
import { experienceDeltas, scalarDelta } from '../game-config.js';
import { type CommandResult, commandRefusal, mutateAndReply } from './command.js';

type HaggleSession = {
    playerId: number;
    sectorNumber: number;
    universeId: number;
    commodity: PriceCommodity;
    action: 'buy' | 'sell';
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

const HAGGLE_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

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

export function clearHaggleSession(playerId: number): void {
    sessions.delete(playerId);
}

function getActiveHaggleSession(playerId: number): HaggleSession | null {
    const s = sessions.get(playerId);
    if (!s) return null;
    if (Date.now() - s.openedAt > HAGGLE_SESSION_TIMEOUT_MS) {
        sessions.delete(playerId);
        return null;
    }
    return s;
}

export async function serveHaggleOpen(
    playerId: number,
    data: CommandRequest<'HaggleOpen'>,
): Promise<CommandResult<'HaggleOpen'>> {
    const player = requireOnlinePlayer(playerId);

    if (!player.docked) {
        return commandRefusal('notDocked');
    }

    const qty = Number.isInteger(data.quantity)
        ? data.quantity
        : parseInt(String(data.quantity), 10);

    const col = data.commodity as Commodity;

    const port = await getPortTradeInfoForUpdate(player.sector, player.universeId);
    if (!port) {
        return commandRefusal('noPortHere');
    }
    const actions = PORT_CLASS_ACTIONS[port.class];
    if (
        !actions ||
        (data.action === 'buy' && actions[col] !== 'S') ||
        (data.action === 'sell' && actions[col] !== 'B')
    ) {
        return commandRefusal('portDoesNotTrade');
    }

    const stock = port[col];
    const max = port[MAX_COL[col]];
    const mcic = port[MCIC_COL[col]];
    if (data.action === 'buy' && qty > stock) {
        return commandRefusal('insufficientPortStock');
    }
    if (data.action === 'sell' && qty > max - stock) {
        return commandRefusal('portCannotBuyThatMany');
    }

    // xp is read once here so pricing stays stable across haggle rounds.
    const xp = await getPlayerExperience(playerId);

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

    return {
        outcome: 'opened',
        commodity: col,
        action: data.action,
        quantity: qty,
        initialOffer,
    };
}

export async function serveHaggleCounter(
    playerId: number,
    data: CommandRequest<'HaggleCounter'>,
): Promise<CommandResult<'HaggleCounter'>> {
    requireOnlinePlayer(playerId);
    const session = getActiveHaggleSession(playerId);
    if (!session) {
        return commandRefusal('noHaggle');
    }
    if (session.isFinalIssued) {
        return commandRefusal('finalOfferIssued');
    }
    const counter = Number.isFinite(data.counter)
        ? Math.floor(data.counter)
        : parseInt(String(data.counter), 10);

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
        return {
            outcome: 'rejected',
            ...(turnsUsed !== undefined ? { turnsUsed } : {}),
        };
    }

    if (step.outcome === 'counter') {
        session.portCurrent = step.newPortOffer;
        session.midRoundsLeft = step.midRoundsLeft;
        return {
            outcome: 'counter',
            newPortOffer: step.newPortOffer,
        };
    }

    if (step.outcome === 'final') {
        session.portCurrent = step.newPortOffer;
        session.isFinalIssued = true;
        return {
            outcome: 'final',
            newPortOffer: step.newPortOffer,
        };
    }

    return settleTrade(playerId, session, step.finalTotal);
}

export async function serveHaggleAccept(playerId: number): Promise<CommandResult<'HaggleAccept'>> {
    const session = getActiveHaggleSession(playerId);
    if (!session) {
        return commandRefusal('noHaggle');
    }
    return settleTrade(playerId, session, session.portCurrent);
}

export function serveHaggleQuit(playerId: number): CommandResult<'HaggleQuit'> {
    clearHaggleSession(playerId);
}

async function settleTrade(
    playerId: number,
    session: HaggleSession,
    agreedTotal: number,
): Promise<CommandResult<'HaggleAccept'>> {
    return mutateAndReply(
        async (client, abort) => {
            // Session state may be stale — re-verify everything under lock.
            const currentSector = await getCurrentSector(playerId, client);
            if (currentSector !== session.sectorNumber) {
                clearHaggleSession(playerId);
                throw abort(commandRefusal('haggleCancelledMoved'));
            }
            const port = await getPortTradeInfoForUpdate(
                session.sectorNumber,
                session.universeId,
                client,
            );
            if (!port) {
                clearHaggleSession(playerId);
                throw abort(commandRefusal('noPortHere'));
            }

            const col = session.commodity as Commodity;
            const stock = port[col];
            const max = port[MAX_COL[col]];
            const cargo = await getShipCargoWithCreditsForUpdate(playerId, client);
            if (!cargo) {
                clearHaggleSession(playerId);
                throw new Error('Player not found');
            }

            let turnsUsed: number | undefined;
            if (session.action === 'buy') {
                const turn = await checkAndDeductTurns(playerId, session.universeId, 1, client);
                if (!turn.allowed) {
                    throw abort(commandRefusal('insufficientTurns'));
                }
                turnsUsed = turn.turnsUsed;

                if (cargo.credits < agreedTotal) {
                    throw abort(commandRefusal('insufficientCredits'));
                }
                if (stock < session.quantity) {
                    clearHaggleSession(playerId);
                    throw abort(commandRefusal('portChangedMidHaggle'));
                }
                if (cargoUsed(cargo) + session.quantity > cargo.cargo_limit) {
                    throw abort(commandRefusal('insufficientHolds'));
                }

                await adjustPortCommodity(port.port_id, col, -session.quantity, client);
                await incrementShipCommodity(playerId, col, session.quantity, client);
                await deductCredits(playerId, agreedTotal, client);
                cargo[col] += session.quantity;
                cargo.credits -= agreedTotal;
            } else {
                if (cargo[col] < session.quantity) {
                    throw abort(commandRefusal('insufficientCargo'));
                }
                if (stock + session.quantity > max) {
                    clearHaggleSession(playerId);
                    throw abort(commandRefusal('portChangedMidHaggle'));
                }

                await adjustPortCommodity(port.port_id, col, session.quantity, client);
                await incrementShipCommodity(playerId, col, -session.quantity, client);
                await addCredits(playerId, agreedTotal, client);
                cargo[col] -= session.quantity;
                cargo.credits += agreedTotal;
            }

            const xpDelta = scalarDelta(experienceDeltas, 'portTrade');
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
                expDelta: xpDelta,
            };
        },
        (result) => {
            clearHaggleSession(playerId);
            if (result.turnsUsed) notifyTurnChange(playerId, result.turnsUsed, 'trading');
            return { outcome: 'accepted' as const, ...result, repDelta: 0 };
        },
    );
}
