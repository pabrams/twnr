import { Router } from 'express';
import { asyncHandler, parseIntParam, HttpError } from './async-handler.js';
import { verifyEntry } from '../services/audit.js';
import { getPlayerCreditsAndUniverse } from '../db/queries/player.js';
import { getUniverseStartingCredits } from '../db/queries/universe.js';
import { listAuditLogForPlayer } from '../db/queries/audit.js';

/**
 * Credit-audit verifier: GET /api/players/:id/credit-audit
 *
 * Returns the player's starting credits, current balance, and the balance
 * implied by summing HMAC-valid audit entries. `consistent: false` means a
 * mismatch — either some entries failed HMAC verification, or the live
 * `players.credits` doesn't equal `starting_credits + sum(delta)`.
 *
 * Both kinds of tampering surface here:
 *   - Direct UPDATE players SET credits = ... → current ≠ expected
 *   - INSERT/UPDATE/DELETE on audit_log (without the in-memory secret)
 *     → either invalid_entries > 0, or the deleted/inserted row shifts
 *       the sum so current ≠ expected
 */
export function createCreditAuditRoutes(router: Router): void {
    router.get(
        '/api/players/:id/credit-audit',
        asyncHandler(async (req, res) => {
            const playerId = parseIntParam(req.params.id, 'id');

            const player = await getPlayerCreditsAndUniverse(playerId);
            if (!player) throw new HttpError(404, 'Player not found');

            const startingCredits = await getUniverseStartingCredits(player.universe_id);
            const auditRows = await listAuditLogForPlayer(playerId);

            let validDeltaSum = 0;
            let invalidEntries = 0;
            for (const row of auditRows) {
                if (verifyEntry(row)) {
                    validDeltaSum += row.delta;
                } else {
                    invalidEntries += 1;
                }
            }

            const expectedCredits = startingCredits + validDeltaSum;
            const consistent = invalidEntries === 0 && player.credits === expectedCredits;

            res.json({
                starting_credits: startingCredits,
                current_credits: player.credits,
                expected_credits: expectedCredits,
                invalid_entries: invalidEntries,
                consistent,
            });
        }),
    );
}
