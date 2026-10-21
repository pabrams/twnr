import { reputationDeltas, experienceDeltas } from '../game-config.js';

export type AlignColor = 'blue' | 'red' | 'neutral';

export function colorOf(rep: number): AlignColor {
    if (rep > 0) return 'blue';
    if (rep < 0) return 'red';
    return 'neutral';
}

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

function safeDiv(num: number, denom: number): number {
    if (!denom) return 0;
    return num / denom;
}

export interface CombatDeltas {
    reputationDelta: number;
    experienceDelta: number;
}

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
    // Enemy align is negated (attacking red = +rep) so the config multiplier is a pure magnitude.
    const reputationDelta = Math.round(
        safeDiv(attackerDronesLost, figsLostDivisor) * (-defenderRep * enemyAlignMultiplier),
    );

    return { reputationDelta, experienceDelta };
}

export function shipDestroyAttackerBonus(args: {
    defenderRepBefore: number;
    defenderExpBefore: number;
}): CombatDeltas {
    const { defenderRepBefore, defenderExpBefore } = args;
    const expFraction = experienceDeltas.factorsFor.shipDestroyBonus_fractionOfEnemyExp ?? 0;
    const repFraction = reputationDeltas.factorsFor.shipDestroyBonus_fractionOfEnemyAlign ?? 0;
    return {
        experienceDelta: Math.floor(defenderExpBefore * expFraction),
        reputationDelta: Math.round(-defenderRepBefore * repFraction),
    };
}

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
