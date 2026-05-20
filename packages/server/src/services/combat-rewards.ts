import { reputationDeltas, experienceDeltas } from '../game-config.js';

export type AlignColor = 'blue' | 'red' | 'neutral';

export function colorOf(rep: number): AlignColor {
    if (rep > 0) return 'blue';
    if (rep < 0) return 'red';
    return 'neutral';
}

/** Color bucket used by PvFigs math: rep === 0 collapses into 'blue'. */
function colorOfNeutralAsBlue(rep: number): 'blue' | 'red' {
    return rep < 0 ? 'red' : 'blue';
}

export type PvpMatchup = 'mixedColor' | 'sameColor' | 'neutralCombatant';
export type PvfigsMatchup = 'mixedColor' | 'sameColor';

export function pvpMatchup(attackerRep: number, defenderRep: number): PvpMatchup {
    const a = colorOf(attackerRep);
    const d = colorOf(defenderRep);
    if (a === 'neutral' || d === 'neutral') return 'neutralCombatant';
    return a === d ? 'sameColor' : 'mixedColor';
}

export function pvfigsMatchup(playerRep: number, ownerRep: number): PvfigsMatchup {
    const p = colorOfNeutralAsBlue(playerRep);
    const o = colorOfNeutralAsBlue(ownerRep);
    return p === o ? 'sameColor' : 'mixedColor';
}

/** Divide and return 0 when the divisor is zero — config-tuning safety. */
function safeDiv(num: number, denom: number): number {
    if (!denom) return 0;
    return num / denom;
}

export interface CombatDeltas {
    reputationDelta: number;
    experienceDelta: number;
}

/**
 * PvP combat rewards for the *attacker* (the defender accrues nothing from
 * the fig exchange itself — only the SD penalty when destroyed).
 *
 * Sign convention: attacking a red enemy yields +rep, attacking blue yields
 * −rep. The raw spec formula uses `enemy_align × multiplier`; we negate
 * `enemy_align` here so a positive `enemyAlignMultiplier` in config means
 * "the magnitude of the effect" without flipping bookkeeping.
 */
export function pvpAttackerDeltas(args: {
    attackerDronesLost: number;
    defenderRep: number;
    matchup: PvpMatchup;
}): CombatDeltas {
    const { attackerDronesLost, defenderRep, matchup } = args;
    if (attackerDronesLost <= 0) return { reputationDelta: 0, experienceDelta: 0 };

    const expDivisor = experienceDeltas.factorsFor[`pvpCombat_yourFigsLostDivisor_${matchup}`] ?? 0;
    const experienceDelta = Math.floor(safeDiv(attackerDronesLost, expDivisor));

    const figsLostDivisor = reputationDeltas.factorsFor.pvpCombat_yourFigsLostDivisor ?? 0;
    const enemyAlignMultiplier = reputationDeltas.factorsFor.pvpCombat_enemyAlignMultiplier ?? 0;
    const reputationDelta = Math.round(
        safeDiv(attackerDronesLost, figsLostDivisor) * (-defenderRep * enemyAlignMultiplier),
    );

    return { reputationDelta, experienceDelta };
}

/**
 * Attacker bonus when the attacker destroys the defender's ship. Snapshot
 * the defender's exp/rep BEFORE applying the SD penalty so this bonus
 * doesn't see the diminished values.
 */
export function shipDestroyAttackerBonus(args: {
    defenderRepBefore: number;
    defenderExpBefore: number;
}): CombatDeltas {
    const { defenderRepBefore, defenderExpBefore } = args;
    const expFraction = experienceDeltas.factorsFor.shipDestroyBonus_fractionOfEnemyExp ?? 0;
    const repFraction = reputationDeltas.factorsFor.shipDestroyBonus_fractionOfEnemyAlign ?? 0;
    return {
        experienceDelta: Math.floor(defenderExpBefore * expFraction),
        // Same sign convention as combat: destroying a red gives +rep,
        // destroying a blue gives −rep. Negate defender's align.
        reputationDelta: Math.round(-defenderRepBefore * repFraction),
    };
}

/**
 * Defender penalty when their ship is destroyed: they lose a fraction of
 * their own exp and align. Align loss is "toward 0" so we subtract the
 * fraction of the current value (blue loses positive, red loses negative
 * → both pull toward neutral).
 */
export function shipDestroyDefenderPenalty(args: {
    defenderRepBefore: number;
    defenderExpBefore: number;
}): CombatDeltas {
    const { defenderRepBefore, defenderExpBefore } = args;
    const expFraction = experienceDeltas.factorsFor.shipDestroyPenalty_fractionOfSelfExp ?? 0;
    const repFraction = reputationDeltas.factorsFor.shipDestroyPenalty_fractionOfSelfAlign ?? 0;
    return {
        experienceDelta: -Math.floor(defenderExpBefore * expFraction),
        reputationDelta: -Math.round(defenderRepBefore * repFraction),
    };
}

/**
 * PvFigs (sector-fighter) combat rewards for the attacking player. Owner
 * (player or clan) accrues nothing.
 *
 * Sign convention matches PvP — owner_align negated so attacking red yields
 * +rep regardless of which divisor branch fires.
 */
export function pvfigsAttackerDeltas(args: {
    playerDronesLost: number;
    ownerAlign: number;
    matchup: PvfigsMatchup;
}): CombatDeltas {
    const { playerDronesLost, ownerAlign, matchup } = args;
    if (playerDronesLost <= 0) return { reputationDelta: 0, experienceDelta: 0 };

    const expKey =
        matchup === 'mixedColor'
            ? 'pvfigsCombat_yourFigsLostDivisor_mixedColor'
            : 'pvfigsCombat_yourFigsLostDivisor_sameColor_blueOrNeutral';
    const expDivisor = experienceDeltas.factorsFor[expKey] ?? 0;
    const experienceDelta = Math.floor(safeDiv(playerDronesLost, expDivisor));

    const repKey =
        matchup === 'mixedColor'
            ? 'pvfigsCombat_ownerAlignDivisor_mixedColor'
            : 'pvfigsCombat_ownerAlignDivisor_sameColor_blueOrNeutral';
    const repDivisor = reputationDeltas.factorsFor[repKey] ?? 0;
    const reputationDelta = Math.round(safeDiv(-ownerAlign, repDivisor) * playerDronesLost);

    return { reputationDelta, experienceDelta };
}
