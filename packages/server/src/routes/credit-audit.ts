import { Router } from 'express';
import { pool } from '../db/index.js';
import { asyncHandler, parseIntParam, HttpError } from './async-handler.js';
import { verifyEntry, type AuditLogRow } from '../services/audit.js';

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

            const playerRes = await pool.query<{
                credits: number;
                universe_id: number;
            }>('SELECT credits, universe_id FROM players WHERE id = $1', [playerId]);
            const player = playerRes.rows[0];
            if (!player) throw new HttpError(404, 'Player not found');

            const settingsRes = await pool.query<{ starting_credits: number }>(
                'SELECT starting_credits FROM universe_settings WHERE universe_id = $1',
                [player.universe_id],
            );
            const startingCredits = settingsRes.rows[0]?.starting_credits ?? 0;

            const auditRes = await pool.query<AuditLogRow>(
                `SELECT id, player_id, action_type, delta, prev_credits, new_credits,
                        context, created_at, hmac
                 FROM audit_log WHERE player_id = $1 ORDER BY id ASC`,
                [playerId],
            );

            let validDeltaSum = 0;
            let invalidEntries = 0;
            for (const row of auditRes.rows) {
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
