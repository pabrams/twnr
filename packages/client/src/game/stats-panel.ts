import type { StatsSnapshot } from '@twnr/shared';
import { renderTaggedHtml } from './renderer.js';
import { fmt, fmtCompact } from './handlers/utils.js';

type RowOpts = {
    valueClass?: string;
    /** Render the value as colored markup (parses [tag]…[/tag]). */
    colored?: boolean;
    title?: string;
};

function row(
    section: HTMLElement,
    label: string,
    value: string | number,
    opts: RowOpts = {},
): void {
    const r = document.createElement('div');
    r.className = 'stats-row';
    if (opts.title) r.title = opts.title;
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'value' + (opts.valueClass ? ` ${opts.valueClass}` : '');
    if (opts.colored && typeof value === 'string') {
        v.appendChild(renderTaggedHtml(value));
    } else {
        v.textContent = String(value);
    }
    r.appendChild(l);
    r.appendChild(v);
    section.appendChild(r);
}

function clearSection(el: HTMLElement): void {
    const h3 = el.querySelector('h3');
    el.replaceChildren();
    if (h3) el.appendChild(h3);
}

/** Hardware key → short label shown in the Ship section. Order matches the
 *  on-screen order requested for the panel. */
const SHIP_HARDWARE_ROWS: { key: string; label: string; title: string }[] = [
    { key: 'proximity_mine', label: 'Mines', title: 'Proximity Mines' },
    { key: 'seeker_mine', label: 'Lmpts', title: 'Limpet Mines' },
    { key: 'mine_disruptor', label: 'Disrp', title: 'Mine Disruptors' },
    { key: 'terraform_device', label: 'Trfm', title: 'Terraform Devices' },
    { key: 'planet_buster', label: 'PBstr', title: 'Planet Busters' },
    { key: 'cloaking_device', label: 'Cloak', title: 'Cloaking Devices' },
    { key: 'photon_torpedo', label: 'Ptn', title: 'Photon Torpedoes' },
    { key: 'buoy', label: 'Bcns', title: 'Marker Beacons' },
    { key: 'recon_drone', label: 'Recon', title: 'Recon Drones' },
];

export interface StatsPanel {
    update(snap: StatsSnapshot): void;
    clear(): void;
}

export function createStatsPanel(container: HTMLElement): StatsPanel {
    const traderEl = container.querySelector<HTMLElement>('#stats-trader');
    const cargoEl = container.querySelector<HTMLElement>('#stats-cargo');
    const shipEl = container.querySelector<HTMLElement>('#stats-ship');
    if (!traderEl || !cargoEl || !shipEl) {
        throw new Error('stats-panel: missing one of #stats-trader/-cargo/-ship');
    }
    const trader: HTMLElement = traderEl;
    const cargo: HTMLElement = cargoEl;
    const ship: HTMLElement = shipEl;

    function update(snap: StatsSnapshot): void {
        clearSection(trader);
        row(trader, 'Sector', fmt(snap.sector));
        row(trader, 'Turns', fmt(snap.turns), {
            valueClass: snap.turns < 50 ? 'warn' : '',
        });
        row(trader, 'Exp', fmt(snap.experience));
        const alignClass =
            snap.alignment > 0 ? 'alignment-good' : snap.alignment < 0 ? 'alignment-bad' : '';
        row(trader, 'Align', fmt(snap.alignment), { valueClass: alignClass });
        row(trader, 'Cr', fmtCompact(snap.credits), { valueClass: 'credits' });

        clearSection(cargo);
        const h = snap.holds;
        row(cargo, 'Fuel', fmt(h.fuel));
        row(cargo, 'Org', fmt(h.organics));
        row(cargo, 'Equ', fmt(h.equipment));
        row(cargo, 'Cols', fmtCompact(h.colonists));
        row(cargo, 'Empty', fmt(h.empty), {
            valueClass: h.empty === 0 ? 'dim' : '',
        });
        row(cargo, 'Total', fmt(h.total));

        clearSection(ship);
        const headline = document.createElement('div');
        headline.className = 'stats-headline';
        headline.title = snap.shipTypeName;
        headline.appendChild(renderTaggedHtml(snap.shipTypeDisplayName ?? snap.shipTypeName));
        ship.appendChild(headline);
        row(ship, 'Drones', fmt(snap.ship.drones));
        row(ship, 'Shlds', fmt(snap.ship.shields));
        for (const def of SHIP_HARDWARE_ROWS) {
            const qty = snap.hardware[def.key] ?? 0;
            row(ship, def.label, fmt(qty), {
                valueClass: qty === 0 ? 'dim' : '',
                title: def.title,
            });
        }
    }

    function clear(): void {
        clearSection(trader);
        clearSection(cargo);
        clearSection(ship);
    }

    return { update, clear };
}
