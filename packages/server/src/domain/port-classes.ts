/** Convention for a port's display name based on its sector number. */
export function portName(sectorId: number): string {
    return `Port ${sectorId}`;
}
