import { HOLD_COST_INCREMENT, holdBaseCostNow, type Class0PriceList } from '@twnr/shared';
import { class0Prices } from '../game-config.js';

/**
 * Wire-shape class-0 price list for the current UTC day. Drone/shield prices
 * come straight from config; the hold base cost is resolved from its daily
 * cycle here so the client can render next-hold pricing without re-deriving it,
 * and so BuyHolds charges exactly what the menu displayed.
 */
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
