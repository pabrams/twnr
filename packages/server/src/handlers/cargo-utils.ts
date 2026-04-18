export interface CargoFields {
    fuel: number;
    organics: number;
    equipment: number;
    colonists: number;
}

export function cargoUsed(c: CargoFields): number {
    return c.fuel + c.organics + c.equipment + c.colonists;
}

export function formatCargo(c: CargoFields): CargoFields {
    return {
        fuel: c.fuel,
        organics: c.organics,
        equipment: c.equipment,
        colonists: c.colonists,
    };
}
