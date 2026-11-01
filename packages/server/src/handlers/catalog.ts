import { requireOnlinePlayer } from '../state/players.js';
import { listUniverseShipTypes } from '../db/queries/ship.js';
import { listUniversePlanetTypes } from '../db/queries/planet.js';
import { listHardwareCatalog, listShipTypeHardwareMaxForUniverse } from '../db/queries/hardware.js';
import { type CommandResult } from './command.js';

export async function serveShipCatalog(playerId: number): Promise<CommandResult<'ShipCatalog'>> {
    const player = requireOnlinePlayer(playerId);

    const [shipTypes, hwRows] = await Promise.all([
        listUniverseShipTypes(player.universeId),
        listShipTypeHardwareMaxForUniverse(player.universeId),
    ]);
    const hwBySlug: Record<string, Record<string, number>> = {};
    for (const h of hwRows) {
        (hwBySlug[h.ship_type_slug] ??= {})[h.name] = h.max_quantity;
    }

    return {
        outcome: 'ok',
        ships: shipTypes.map((st) => ({
            name: st.slug,
            displayName: st.display_name,
            make: st.make,
            maxDrones: st.max_drones,
            maxShields: st.max_shields,
            startingHolds: st.starting_holds,
            maxHolds: st.max_holds,
            oddsOffensive: st.odds_offensive,
            oddsDefensive: st.odds_defensive,
            maxDroneAttack: st.max_drone_attack,
            speed: st.speed,
            turnsPerWarp: st.turns_per_warp,
            transporterRange: st.transporter_range,
            costDrive: st.cost_drive,
            costComputer: st.cost_computer,
            costHull: st.cost_hull,
            holdCost: st.hold_cost,
            baseCost: st.base_cost,
            hasPod: st.has_pod,
            canLand: st.can_land,
            hasInterdictor: st.has_interdictor,
            hasTractor: st.has_tractor,
            hasPlanetaryDefenseBonus: st.has_planetary_defense_bonus,
            planetaryDefenseOdds: st.planetary_defense_odds,
            pilotingRestriction: st.piloting_restriction,
            notes: st.notes,
            hardware: hwBySlug[st.slug] ?? {},
        })),
    };
}

export async function servePlanetCatalog(
    playerId: number,
): Promise<CommandResult<'PlanetCatalog'>> {
    const player = requireOnlinePlayer(playerId);

    const planetTypes = await listUniversePlanetTypes(player.universeId);
    return {
        outcome: 'ok',
        planets: planetTypes.map((pt) => ({
            slug: pt.slug,
            displayName: pt.display_name,
            description: pt.description,
            class: pt.class,
            danger: pt.danger,
            maxFuelColos: pt.max_fuel_colos,
            maxOrgColos: pt.max_org_colos,
            maxEquColos: pt.max_equ_colos,
            maxFuel: pt.max_fuel,
            maxOrg: pt.max_org,
            maxEqu: pt.max_equ,
            maxDrones: pt.max_drones,
            maxCitadel: pt.max_citadel,
            fuelProduction: pt.fuel_production,
            organicsProduction: pt.organics_production,
            equipmentProduction: pt.equipment_production,
            figFactorFuel: pt.fig_factor_fuel,
            figFactorOrg: pt.fig_factor_org,
            figFactorEqu: pt.fig_factor_equ,
        })),
    };
}

export async function serveHardwareCatalog(): Promise<CommandResult<'HardwareCatalog'>> {
    const items = await listHardwareCatalog();
    return {
        outcome: 'ok',
        items: items.map((i) => ({ name: i.name, label: i.label, kind: i.kind })),
    };
}
