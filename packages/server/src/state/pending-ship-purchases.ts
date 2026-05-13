export type PendingShipPurchase =
    | { kind: 'new'; targetShipName: string }
    | { kind: 'tradein'; targetShipName: string };

const pending = new Map<number, PendingShipPurchase>();

export function setPendingShipPurchase(playerId: number, p: PendingShipPurchase): void {
    pending.set(playerId, p);
}

export function getPendingShipPurchase(playerId: number): PendingShipPurchase | undefined {
    return pending.get(playerId);
}

export function clearPendingShipPurchase(playerId: number): void {
    pending.delete(playerId);
}
