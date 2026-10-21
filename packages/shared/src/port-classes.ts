/** The port's side: it buys (B) or sells (S) the commodity. */
export type PortAction = 'B' | 'S';
export type PortClassActions = Record<'fuel' | 'organics' | 'equipment', PortAction>;

export const PORT_CLASS_ACTIONS: Record<number, PortClassActions> = {
    1: { fuel: 'B', organics: 'B', equipment: 'S' },
    2: { fuel: 'B', organics: 'S', equipment: 'B' },
    3: { fuel: 'S', organics: 'B', equipment: 'B' },
    4: { fuel: 'S', organics: 'S', equipment: 'B' },
    5: { fuel: 'B', organics: 'S', equipment: 'S' },
    6: { fuel: 'S', organics: 'B', equipment: 'S' },
    7: { fuel: 'S', organics: 'S', equipment: 'S' },
    8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

export function portClassTriplet(cls: number): string | null {
    const a = PORT_CLASS_ACTIONS[cls];
    return a ? a.fuel + a.organics + a.equipment : null;
}
