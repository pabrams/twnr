import type { NeighborhoodResultObject, NeighborhoodSector } from '@twnr/shared';
import './minimap.css';

type MinimapState = {
    depth: number;
    data: NeighborhoodResultObject | null;
    currentSectorNumber: number;
    /** When non-null, the six adjacent-warp targets for the open quick-move menu (sector numbers, 1-indexed by order). */
    quickMoveTargets: number[] | null;
};

export type MinimapInjectionHandler = (sectorNumber: number, currentSector: number) => void;

export interface Minimap {
    /** Update with a NEIGHBORHOOD result from the server. */
    update(data: NeighborhoodResultObject, currentSectorNumber: number): void;
    /** Current hop-depth (for refetching). */
    getDepth(): number;
    /** Register a handler invoked on every redraw request, e.g. to refetch. */
    onRequestRefresh(handler: () => void): void;
    /** Highlight these sector numbers as 1..N quick-move targets, or clear with null. */
    setQuickMove(targets: number[] | null): void;
}

const DEFAULT_DEPTH = 3;
const MIN_DEPTH = 2;
const MAX_DEPTH = 5;

// Port class to three-letter B/S triplet (matches server port_classes table).
const PORT_CLASS_TRIPLET: Record<number, string> = {
    1: 'BBS',
    2: 'BSB',
    3: 'SBB',
    4: 'SSB',
    5: 'BSS',
    6: 'SBS',
    7: 'SSS',
    8: 'BBB',
    9: '---',
    0: '---',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createMinimap(container: HTMLElement, onInject: MinimapInjectionHandler): Minimap {
    const state: MinimapState = {
        depth: DEFAULT_DEPTH,
        data: null,
        currentSectorNumber: 0,
        quickMoveTargets: null,
    };

    const body = container.querySelector<HTMLElement>('.minimap-body')!;
    const svg = container.querySelector<SVGSVGElement>('.minimap-svg')!;
    const emptyState = container.querySelector<HTMLElement>('.empty-state')!;
    const tooltip = container.querySelector<HTMLElement>('.tooltip')!;
    const depthBtns = Array.from(container.querySelectorAll<HTMLButtonElement>('.depth-btn'));

    let refreshHandler: (() => void) | null = null;

    function setActiveDepthButton(depth: number): void {
        for (const btn of depthBtns) {
            const btnDepth = Number(btn.dataset.depth);
            btn.classList.toggle('active', btnDepth === depth);
        }
    }

    for (const btn of depthBtns) {
        btn.addEventListener('click', () => {
            const d = Number(btn.dataset.depth);
            if (!Number.isFinite(d) || d < MIN_DEPTH || d > MAX_DEPTH) return;
            if (d === state.depth) return;
            state.depth = d;
            setActiveDepthButton(d);
            refreshHandler?.();
        });
    }

    setActiveDepthButton(state.depth);

    function showTooltip(evt: MouseEvent, text: string): void {
        tooltip.textContent = text;
        tooltip.classList.add('is-visible');
        const rect = body.getBoundingClientRect();
        const x = Math.min(evt.clientX - rect.left + 10, rect.width - 230);
        const y = Math.min(evt.clientY - rect.top + 10, rect.height - 80);
        tooltip.style.left = Math.max(4, x) + 'px';
        tooltip.style.top = Math.max(4, y) + 'px';
    }
    function hideTooltip(): void {
        tooltip.classList.remove('is-visible');
    }

    function tooltipText(sector: NeighborhoodSector): string {
        if (sector.visibility === 'glimpsed') {
            return `Sector ${sector.sector_number}`;
        }
        const lines: string[] = [`Sector ${sector.sector_number}`];
        if (sector.port) {
            const triplet = PORT_CLASS_TRIPLET[sector.port.class] ?? '???';
            lines.push(`Port class ${sector.port.class} (${triplet})`);
            lines.push(`Observed: ${formatObserved(sector.port.observed_at)}`);
        }
        if (sector.planets.length > 0) {
            lines.push(`Planets (${sector.planets.length}):`);
            for (const p of sector.planets) {
                const type = p.type ? ` [${p.type}]` : '';
                lines.push(`  • ${p.name}${type}`);
                lines.push(`    observed ${formatObserved(p.observed_at)}`);
            }
        }
        return lines.join('\n');
    }

    function formatObserved(iso: string): string {
        try {
            const d = new Date(iso);
            return d.toLocaleString();
        } catch {
            return iso;
        }
    }

    function render(): void {
        svg.replaceChildren();
        if (state.data && state.data.topology === 'random') {
            // Hide the whole panel; the terminal flexes to full width.
            container.classList.add('is-hidden');
            return;
        }
        container.classList.remove('is-hidden');
        if (!state.data) {
            emptyState.classList.remove('is-hidden');
            emptyState.textContent = 'Loading map…';
            return;
        }
        if (state.data.sectors.length === 0) {
            emptyState.classList.remove('is-hidden');
            emptyState.textContent = 'No visited sectors yet — move to populate the map.';
            return;
        }
        emptyState.classList.add('is-hidden');

        const sectors = state.data.sectors;
        const currentId = state.data.current_sector_id;
        const byId = new Map<number, NeighborhoodSector>();
        for (const s of sectors) byId.set(s.id, s);
        const current = byId.get(currentId);

        // Quick-move: map each target sector_number (from the open move menu)
        // to its 1-based slot, and resolve those to sector_ids we can match
        // against warp endpoints + pills below.
        const quickMoveIndexById = new Map<number, number>();
        if (state.quickMoveTargets && state.quickMoveTargets.length > 0) {
            const numberToId = new Map<number, number>();
            for (const s of sectors) numberToId.set(s.sector_number, s.id);
            state.quickMoveTargets.forEach((secNum, i) => {
                const id = numberToId.get(secNum);
                if (id !== undefined) quickMoveIndexById.set(id, i + 1);
            });
        }

        // Compute bbox from all positioned sectors.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let positionedCount = 0;
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            positionedCount++;
            if (s.x < minX) minX = s.x;
            if (s.x > maxX) maxX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.y > maxY) maxY = s.y;
        }
        if (positionedCount === 0) {
            emptyState.classList.remove('is-hidden');
            emptyState.textContent = 'No positioned sectors in view.';
            return;
        }

        // Force-directed relaxation. The server stores absolute positions, but
        // the visible subset is often clumpy with large empty patches. Repel
        // nearby nodes toward a target spacing while a weak anchor tugs each
        // node back toward its original position — clusters expand, overall
        // orientation is preserved, distances are no longer strictly to scale.
        type DispPos = { x: number; y: number; ox: number; oy: number };
        const disp = new Map<number, DispPos>();
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            disp.set(s.id, { x: s.x, y: s.y, ox: s.x, oy: s.y });
        }
        const dispIds = Array.from(disp.keys());
        const dispN = dispIds.length;
        const extent = Math.max(maxX - minX, maxY - minY, 1);
        // Minimum spacing floor: keep wider pills (multi-digit sector numbers)
        // from overlapping even in dense neighborhoods. Converted from target
        // on-screen pixels using the panel's current width.
        let maxDigits = 1;
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            const len = String(s.sector_number).length;
            if (len > maxDigits) maxDigits = len;
        }
        const panelPxEst = body.clientWidth || 320;
        const worldPerPxEst = Math.max(extent, 200) / panelPxEst;
        const labelPx = 9;
        const minPxSpacing = maxDigits * labelPx * 0.62 + labelPx * 2.4;
        const minWorldSpacing = minPxSpacing * worldPerPxEst;
        const targetSpacing = Math.max(
            (extent / Math.max(Math.sqrt(dispN), 1)) * 1.2,
            minWorldSpacing,
        );

        // BFS hop-distance from the current sector through the visible warp
        // subgraph (undirected for layout purposes — direction doesn't matter
        // when spacing things visually). Used to bias the relaxation so pairs
        // involving low-hop nodes get bigger spacing and weaker anchor pull,
        // opening up the area around the current sector while leaving distant
        // clumps alone.
        const hop = new Map<number, number>();
        if (current && disp.has(current.id)) {
            const adj = new Map<number, Set<number>>();
            for (const w of state.data.warps) {
                if (!disp.has(w.from_sector_id) || !disp.has(w.to_sector_id)) continue;
                if (!adj.has(w.from_sector_id)) adj.set(w.from_sector_id, new Set());
                if (!adj.has(w.to_sector_id)) adj.set(w.to_sector_id, new Set());
                adj.get(w.from_sector_id)!.add(w.to_sector_id);
                adj.get(w.to_sector_id)!.add(w.from_sector_id);
            }
            hop.set(current.id, 0);
            const bq: number[] = [current.id];
            while (bq.length > 0) {
                const u = bq.shift()!;
                const d = hop.get(u)!;
                for (const v of adj.get(u) ?? []) {
                    if (hop.has(v)) continue;
                    hop.set(v, d + 1);
                    bq.push(v);
                }
            }
        }
        const hopOf = (id: number): number => hop.get(id) ?? 99;
        // Spacing multiplier for a pair, keyed by the closer-to-current node.
        // Hop 0 (pair with current) or 1 (immediate-neighbour pair): big spread.
        // Hop 2: a touch more breathing room. Further: unchanged.
        const spacingMult = (minHop: number): number =>
            minHop <= 1 ? 1.8 : minHop === 2 ? 1.25 : 1.0;
        // Anchor multiplier per node. Weaker pull for low-hop nodes lets them
        // drift further from their server positions to use available space.
        const anchorMult = (h: number): number => (h <= 1 ? 0.3 : h === 2 ? 0.7 : 1.0);

        const ANCHOR = 0.04;
        const ITERS = 100;
        for (let iter = 0; iter < ITERS; iter++) {
            const cool = 1 - iter / ITERS;
            for (let i = 0; i < dispN; i++) {
                const a = disp.get(dispIds[i])!;
                const ha = hopOf(dispIds[i]);
                for (let j = i + 1; j < dispN; j++) {
                    const b = disp.get(dispIds[j])!;
                    const hb = hopOf(dispIds[j]);
                    const pairSpacing = targetSpacing * spacingMult(Math.min(ha, hb));
                    let dx = b.x - a.x;
                    let dy = b.y - a.y;
                    let d2 = dx * dx + dy * dy;
                    if (d2 < 1e-6) {
                        // Coincident points: nudge along a deterministic axis
                        // derived from their indices so layout stays stable.
                        dx = (i - j) * 0.01;
                        dy = (j - i) * 0.013;
                        d2 = dx * dx + dy * dy;
                    }
                    if (d2 < pairSpacing * pairSpacing) {
                        const d = Math.sqrt(d2);
                        const push = (pairSpacing - d) * 0.5 * cool;
                        const ux = dx / d;
                        const uy = dy / d;
                        a.x -= ux * push;
                        a.y -= uy * push;
                        b.x += ux * push;
                        b.y += uy * push;
                    }
                }
            }
            for (const id of dispIds) {
                const p = disp.get(id)!;
                const a = ANCHOR * anchorMult(hopOf(id));
                p.x += (p.ox - p.x) * a;
                p.y += (p.oy - p.y) * a;
            }
        }

        // Recompute bbox/pivot from adjusted positions. ViewSize is 2 × max
        // reach from the pivot, so the farthest visible sector sits at an edge
        // and the current sector stays dead-center.
        let minDX = Infinity;
        let maxDX = -Infinity;
        let minDY = Infinity;
        let maxDY = -Infinity;
        for (const p of disp.values()) {
            if (p.x < minDX) minDX = p.x;
            if (p.x > maxDX) maxDX = p.x;
            if (p.y < minDY) minDY = p.y;
            if (p.y > maxDY) maxDY = p.y;
        }
        const currentDisp = current ? (disp.get(current.id) ?? null) : null;
        const pivotX = currentDisp?.x ?? (minDX + maxDX) / 2;
        const pivotY = currentDisp?.y ?? (minDY + maxDY) / 2;
        let maxReach = 0;
        for (const p of disp.values()) {
            const dx = Math.abs(p.x - pivotX);
            const dy = Math.abs(p.y - pivotY);
            if (dx > maxReach) maxReach = dx;
            if (dy > maxReach) maxReach = dy;
        }
        const reachPad = Math.max(maxReach * 0.12, 50);
        const viewSize = Math.max(maxReach * 2 + reachPad * 2, 200);
        svg.setAttribute(
            'viewBox',
            `${pivotX - viewSize / 2} ${pivotY - viewSize / 2} ${viewSize} ${viewSize}`,
        );
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        // Defs for arrowhead markers.
        const defs = document.createElementNS(SVG_NS, 'defs');
        defs.innerHTML = `
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5"
                orient="auto-start-reverse">
              <path class="minimap-arrowhead--neutral" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker id="arrDim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5"
                orient="auto-start-reverse">
              <path class="minimap-arrowhead--dim" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker id="arrRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5"
                orient="auto-start-reverse">
              <path class="minimap-arrowhead--danger" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>`;
        svg.appendChild(defs);

        // Pixel-space sizing: convert target on-screen pixel sizes into world
        // units using the panel's rendered width, so labels/nodes stay a
        // constant pixel size regardless of how far the player has explored.
        const panelPx = body.clientWidth || 320;
        const worldPerPx = viewSize / panelPx;
        const labelSize = 8 * worldPerPx;
        const strokeW = 1.2 * worldPerPx;

        // Precompute pill bounds so warp lines can be trimmed to each pill's
        // edge, leaving arrowheads visible outside the destination pill.
        const pillById = new Map<number, { rw: number; rh: number }>();
        for (const s of sectors) {
            if (!disp.has(s.id)) continue;
            const isCurrent = s.id === currentId;
            const fontPx = isCurrent ? labelSize * 1.2 : labelSize;
            const cw = fontPx * 0.62;
            const px = fontPx * 0.5;
            const py = fontPx * 0.3;
            const rw = String(s.sector_number).length * cw + px * 2;
            const rh = fontPx + py * 2;
            pillById.set(s.id, { rw, rh });
        }

        // Trim a line from `fromPt` toward a pill centered at `centerPt` so it
        // ends exactly `pad` world units outside the pill's axis-aligned bbox.
        function trimToPill(
            fromPt: { x: number; y: number },
            centerPt: { x: number; y: number },
            rw: number,
            rh: number,
            pad: number,
        ): { x: number; y: number } {
            const dx = fromPt.x - centerPt.x;
            const dy = fromPt.y - centerPt.y;
            const adx = Math.abs(dx);
            const ady = Math.abs(dy);
            if (adx < 1e-6 && ady < 1e-6) return { x: centerPt.x, y: centerPt.y };
            const halfW = rw / 2 + pad;
            const halfH = rh / 2 + pad;
            const tx = adx > 1e-6 ? halfW / adx : Infinity;
            const ty = ady > 1e-6 ? halfH / ady : Infinity;
            const t = Math.min(tx, ty);
            return { x: centerPt.x + dx * t, y: centerPt.y + dy * t };
        }

        // Draw warps first so they sit behind nodes.
        const warpGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(warpGroup);
        // De-dupe bi-pairs: draw one line per undirected pair when known_two_way.
        const drawnBi = new Set<string>();
        for (const w of state.data.warps) {
            const src = byId.get(w.from_sector_id);
            const dst = byId.get(w.to_sector_id);
            if (!src || !dst) continue;
            const srcP = disp.get(w.from_sector_id);
            const dstP = disp.get(w.to_sector_id);
            if (!srcP || !dstP) continue;
            const srcPill = pillById.get(w.from_sector_id);
            const dstPill = pillById.get(w.to_sector_id);
            if (!srcPill || !dstPill) continue;
            const srcVisited = src.visibility === 'visited';
            const dstVisited = dst.visibility === 'visited';
            const isTwoWay = srcVisited && dstVisited && w.known_two_way;
            if (isTwoWay) {
                const key = `${Math.min(w.from_sector_id, w.to_sector_id)}-${Math.max(w.from_sector_id, w.to_sector_id)}`;
                if (drawnBi.has(key)) continue;
                drawnBi.add(key);
            }
            // Bigger destination pad when an arrowhead needs to clear the pill.
            const dstPad = isTwoWay ? strokeW * 0.5 : strokeW * 3;
            const srcPad = strokeW * 0.5;
            const start = trimToPill(dstP, srcP, srcPill.rw, srcPill.rh, srcPad);
            const end = trimToPill(srcP, dstP, dstPill.rw, dstPill.rh, dstPad);

            // Offset directed warps slightly to the RIGHT of their direction
            // of travel. Opposite-direction warps between the same pair end
            // up on opposite sides of the axis, so overlapping one-ways
            // separate visually instead of drawing on top of each other.
            if (!isTwoWay) {
                const dx = dstP.x - srcP.x;
                const dy = dstP.y - srcP.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 1e-6) {
                    const off = 3 * worldPerPx; // ~3 on-screen pixels
                    // Right-perpendicular in SVG y-down coords: (-uy, ux).
                    const offX = (-dy / len) * off;
                    const offY = (dx / len) * off;
                    start.x += offX;
                    start.y += offY;
                    end.x += offX;
                    end.y += offY;
                }
            }

            // Two-way warps get a slightly wider black halo drawn immediately
            // behind the colored line. At crossings, a later warp's halo
            // punches a visible gap through earlier warps, making it clear
            // which segments are connected (the "tunnel under" effect).
            if (isTwoWay) {
                const halo = document.createElementNS(SVG_NS, 'line');
                halo.classList.add('minimap-warp-halo');
                halo.setAttribute('x1', String(start.x));
                halo.setAttribute('y1', String(start.y));
                halo.setAttribute('x2', String(end.x));
                halo.setAttribute('y2', String(end.y));
                halo.setAttribute('stroke-width', String(strokeW * 2.4));
                warpGroup.appendChild(halo);
            }

            const line = document.createElementNS(SVG_NS, 'line');
            line.classList.add('minimap-warp');
            line.setAttribute('x1', String(start.x));
            line.setAttribute('y1', String(start.y));
            line.setAttribute('x2', String(end.x));
            line.setAttribute('y2', String(end.y));
            line.setAttribute('stroke-width', String(strokeW));
            // Outgoing warp from the current sector to a quick-move target:
            // highlight so the player can see which number leads where.
            const isQuickMoveWarp =
                w.from_sector_id === currentId && quickMoveIndexById.has(w.to_sector_id);
            if (isQuickMoveWarp) {
                line.classList.add('minimap-warp--quick-move');
            }
            if (isTwoWay) {
                line.classList.add('minimap-warp--two-way');
            } else if (srcVisited && dstVisited) {
                // Both endpoints visited but reverse warp absent from the
                // universe — confirmed one-way. Draw in red with arrowhead.
                line.classList.add('minimap-warp--one-way-confirmed');
                line.setAttribute('marker-end', 'url(#arrRed)');
            } else {
                // source visited, target glimpsed: dotted line with arrowhead
                line.classList.add('minimap-warp--unexplored');
                line.setAttribute('stroke-dasharray', `${strokeW * 2} ${strokeW * 2}`);
                line.setAttribute('marker-end', 'url(#arrDim)');
            }
            warpGroup.appendChild(line);
        }

        // Draw sector nodes as rounded pills with the sector number inside.
        // The current sector gets a scaled-up pill so it reads at a glance.
        const nodeGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(nodeGroup);
        for (const s of sectors) {
            const p = disp.get(s.id);
            if (!p) continue;
            const isCurrent = s.id === currentId;
            const labelText = String(s.sector_number);
            const fontPx = isCurrent ? labelSize * 1.2 : labelSize;
            const cw = fontPx * 0.62;
            const px = fontPx * 0.5;
            const py = fontPx * 0.3;
            const rw = labelText.length * cw + px * 2;
            const rh = fontPx + py * 2;
            const rx = fontPx * 0.35;

            const group = document.createElementNS(SVG_NS, 'g');
            group.classList.add('sector-node');
            group.setAttribute('transform', `translate(${p.x}, ${p.y})`);

            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(-rw / 2));
            rect.setAttribute('y', String(-rh / 2));
            rect.setAttribute('width', String(rw));
            rect.setAttribute('height', String(rh));
            rect.setAttribute('rx', String(rx));
            rect.setAttribute('ry', String(rx));
            if (isCurrent) {
                rect.classList.add('minimap-sector-pill--current');
                rect.setAttribute('stroke-width', String(strokeW * 1.5));
            } else if (s.visibility === 'visited') {
                rect.classList.add('minimap-sector-pill--visited');
                rect.setAttribute('stroke-width', String(strokeW));
            } else {
                rect.classList.add('minimap-sector-pill--glimpsed');
                rect.setAttribute('stroke-width', String(strokeW * 0.8));
                rect.setAttribute('stroke-dasharray', `${strokeW} ${strokeW}`);
            }
            const quickMoveIndex = quickMoveIndexById.get(s.id);
            if (quickMoveIndex !== undefined) {
                rect.classList.add('minimap-sector-pill--quick-move');
                rect.setAttribute('stroke-width', String(strokeW * 1.8));
            }
            group.appendChild(rect);

            const label = document.createElementNS(SVG_NS, 'text');
            label.classList.add('minimap-sector-label');
            if (isCurrent) {
                label.classList.add('minimap-sector-label--current');
            } else if (s.visibility === 'visited') {
                label.classList.add('minimap-sector-label--visited');
            } else {
                label.classList.add('minimap-sector-label--glimpsed');
            }
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'central');
            label.setAttribute('font-size', String(fontPx));
            label.textContent = labelText;
            group.appendChild(label);

            // Planet glyph — visited only. Sits just above the pill's
            // top-right corner so it doesn't compete with the number.
            if (s.visibility === 'visited' && s.planets.length > 0) {
                const planetGlyph = document.createElementNS(SVG_NS, 'text');
                planetGlyph.classList.add('minimap-planet-glyph');
                planetGlyph.setAttribute('text-anchor', 'start');
                planetGlyph.setAttribute('x', String(rw / 2 - fontPx * 0.15));
                planetGlyph.setAttribute('y', String(-rh / 2 - fontPx * 0.15));
                planetGlyph.setAttribute('font-size', String(fontPx * 0.9));
                planetGlyph.textContent = s.planets.length > 1 ? `◉${s.planets.length}` : '◉';
                group.appendChild(planetGlyph);
            }

            // Quick-move badge: a small circle with the 1..6 slot number,
            // placed below the pill so it doesn't compete with the sector
            // number. Only drawn while the move menu is open.
            if (quickMoveIndex !== undefined) {
                const badgeR = fontPx * 0.65;
                const badgeY = rh / 2 + badgeR + fontPx * 0.25;
                const badgeCircle = document.createElementNS(SVG_NS, 'circle');
                badgeCircle.classList.add('minimap-quick-move-badge');
                badgeCircle.setAttribute('cx', '0');
                badgeCircle.setAttribute('cy', String(badgeY));
                badgeCircle.setAttribute('r', String(badgeR));
                badgeCircle.setAttribute('stroke-width', String(strokeW));
                group.appendChild(badgeCircle);
                const badgeText = document.createElementNS(SVG_NS, 'text');
                badgeText.classList.add('minimap-quick-move-badge-text');
                badgeText.setAttribute('text-anchor', 'middle');
                badgeText.setAttribute('dominant-baseline', 'central');
                badgeText.setAttribute('x', '0');
                badgeText.setAttribute('y', String(badgeY));
                badgeText.setAttribute('font-size', String(fontPx * 0.95));
                badgeText.textContent = String(quickMoveIndex);
                group.appendChild(badgeText);
            }

            // Interaction.
            const tip = tooltipText(s);
            group.addEventListener('mouseenter', (ev) => showTooltip(ev as MouseEvent, tip));
            group.addEventListener('mousemove', (ev) => showTooltip(ev as MouseEvent, tip));
            group.addEventListener('mouseleave', hideTooltip);
            group.addEventListener('click', () => {
                hideTooltip();
                onInject(s.sector_number, current?.sector_number ?? state.currentSectorNumber);
            });

            nodeGroup.appendChild(group);
        }
    }

    return {
        update(data, currentSectorNumber) {
            state.data = data;
            state.currentSectorNumber = currentSectorNumber;
            render();
        },
        getDepth() {
            return state.depth;
        },
        onRequestRefresh(handler) {
            refreshHandler = handler;
        },
        setQuickMove(targets) {
            state.quickMoveTargets = targets && targets.length > 0 ? [...targets] : null;
            render();
        },
    };
}

/** Apply a short border-flash animation to the terminal element. */
export function flashTerminalBorder(termEl: HTMLElement, duration = 800): void {
    termEl.classList.add('flash-border');
    window.setTimeout(() => termEl.classList.remove('flash-border'), duration);
}
