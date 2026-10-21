import { HOLD_COST_INCREMENT, holdBaseCostNow, type Class0PriceList } from '@twnr/shared';
import { class0Prices } from '../game-config.js';

export function currentClass0Prices(): Class0PriceList {
    return {
        dronePrice: class0Prices.dronePrice,
        shieldPrice: class0Prices.shieldPrice,
        holdBaseCost: holdBaseCostNow(
            class0Prices.holdBaseCostMin,
            class0Prices.holdBaseCostMax,
            class0Prices.holdCostPeriodDays,
        ),
        holdCostIncrement: HOLD_COST_INCREMENT,
    };
}
