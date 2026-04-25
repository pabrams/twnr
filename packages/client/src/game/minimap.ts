import type { NeighborhoodResultObject, NeighborhoodSector } from '@twnr/shared';
import './minimap.css';

type MinimapState = {
    depth: number;
    data: NeighborhoodResultObject | null;
    currentSectorNumber: number;
    /** The six adjacent-warp targets for the open quick-move menu (sector numbers, 1-indexed by order). */
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

        // Compute bbox from all positioned sectors. Fringe sectors (beyond the
        // max-depth frontier) are excluded so they don't blow up the viewBox —
        // their warp stubs emanate from the pill edge of visible sectors.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let positionedCount = 0;
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            if (s.fringe) continue;
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

        // Use server positions directly. The server runs Fruchterman-Reingold
        // once per universe, so its coordinates are already globally
        // consistent and edge-spread.
        const disp = new Map<number, { x: number; y: number }>();
        // Fringe sectors live in a separate map — they're never drawn as pills
        // but their positions are used as direction vectors for warp stubs.
        const fringePos = new Map<number, { x: number; y: number }>();
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            if (s.fringe) {
                fringePos.set(s.id, { x: s.x, y: s.y });
                continue;
            }
            disp.set(s.id, { x: s.x, y: s.y });
        }

        // Frame the view on the bbox of visible (non-fringe) pills. The
        // current sector is no longer forced to the center of the viewport;
        // a stable bbox pivot keeps the map from rotating/shifting dramatically
        // as the player moves between sectors.
        const spanX = maxX - minX;
        const spanY = maxY - minY;
        const pivotX = (minX + maxX) / 2;
        const pivotY = (minY + maxY) / 2;
        const spanMax = Math.max(spanX, spanY, 1);
        const reachPad = Math.max(spanMax * 0.1, 50);
        const viewSize = Math.max(spanMax + reachPad * 2, 200);
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
            </marker>
            <marker id="arrTwoWay" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5"
                orient="auto-start-reverse">
              <path class="minimap-arrowhead--two-way" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>`;
        svg.appendChild(defs);

        // Pixel-space sizing: convert target on-screen pixel sizes into world
        // units using the panel's rendered width, so labels/nodes stay a
        // constant pixel size regardless of how far the player has explored.
        const panelPx = body.clientWidth || 320;
        const worldPerPx = viewSize / panelPx;
        const labelSize = 12 * worldPerPx;
        const strokeW = 1.7 * worldPerPx;

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

        // Collision-only relaxation. Pairs of pills whose centres are closer
        // than (rA + rB) × pad feel a pairwise push proportional to overlap;
        // well-separated pills are untouched, preserving the stable
        // orientation that using server positions directly gives us. Fixes
        // local clumping where the server graph has dense sibling clusters.
        const PILL_PAD = 1.15;
        const COLLISION_ITERS = 60;
        const dispIds = Array.from(disp.keys());
        for (let iter = 0; iter < COLLISION_ITERS; iter++) {
            for (let i = 0; i < dispIds.length; i++) {
                const idA = dispIds[i];
                const pA = disp.get(idA)!;
                const pillA = pillById.get(idA);
                if (!pillA) continue;
                const rA = Math.max(pillA.rw, pillA.rh) / 2;
                for (let j = i + 1; j < dispIds.length; j++) {
                    const idB = dispIds[j];
                    const pB = disp.get(idB)!;
                    const pillB = pillById.get(idB);
                    if (!pillB) continue;
                    const rB = Math.max(pillB.rw, pillB.rh) / 2;
                    const minDist = (rA + rB) * PILL_PAD;
                    let dx = pB.x - pA.x;
                    let dy = pB.y - pA.y;
                    let d2 = dx * dx + dy * dy;
                    if (d2 >= minDist * minDist) continue;
                    let d = Math.sqrt(d2);
                    if (d < 1e-3) {
                        // Near-coincident: pick a deterministic direction
                        // from the sector ids so renders stay stable.
                        dx = ((idA * 2654435761) & 0xffff) / 0x8000 - 1 || 1;
                        dy = ((idB * 2246822519) & 0xffff) / 0x8000 - 1 || 1;
                        d = Math.sqrt(dx * dx + dy * dy) || 1;
                    }
                    const push = (minDist - d) * 0.5;
                    const ux = dx / d;
                    const uy = dy / d;
                    pA.x -= ux * push;
                    pA.y -= uy * push;
                    pB.x += ux * push;
                    pB.y += uy * push;
                }
            }
        }

        // Recompute bbox from collision-adjusted positions so the viewBox
        // includes any spread the pass introduced.
        let cMinX = Infinity;
        let cMaxX = -Infinity;
        let cMinY = Infinity;
        let cMaxY = -Infinity;
        for (const p of disp.values()) {
            if (p.x < cMinX) cMinX = p.x;
            if (p.x > cMaxX) cMaxX = p.x;
            if (p.y < cMinY) cMinY = p.y;
            if (p.y > cMaxY) cMaxY = p.y;
        }
        const cSpanMax = Math.max(cMaxX - cMinX, cMaxY - cMinY, 1);
        const cPad = Math.max(cSpanMax * 0.1, 50);
        const cViewSize = Math.max(cSpanMax + cPad * 2, 200);
        const cPivotX = (cMinX + cMaxX) / 2;
        const cPivotY = (cMinY + cMaxY) / 2;
        svg.setAttribute(
            'viewBox',
            `${cPivotX - cViewSize / 2} ${cPivotY - cViewSize / 2} ${cViewSize} ${cViewSize}`,
        );

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
        const FRINGE_STUB_PX = 30; // stub length in on-screen pixels
        for (const w of state.data.warps) {
            const src = byId.get(w.from_sector_id);
            const dst = byId.get(w.to_sector_id);
            if (!src || !dst) continue;
            const srcP = disp.get(w.from_sector_id);
            // Destination may be fringe (no pill); fall back to its raw server
            // position so we still have a direction vector for the stub.
            const dstP = disp.get(w.to_sector_id) ?? fringePos.get(w.to_sector_id);
            if (!srcP || !dstP) continue;
            const srcPill = pillById.get(w.from_sector_id);
            const dstPill = pillById.get(w.to_sector_id);
            if (!srcPill) continue;
            const srcVisited = src.visibility === 'visited';
            const dstVisited = dst.visibility === 'visited';
            const isFringe = dst.fringe === true;
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
            // Fringe target: end at a fixed-length stub in the source→target
            // direction rather than trimming to a (non-existent) pill.
            let end: { x: number; y: number };
            if (isFringe) {
                const dx = dstP.x - srcP.x;
                const dy = dstP.y - srcP.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const stub = FRINGE_STUB_PX * worldPerPx;
                end = {
                    x: start.x + (dx / len) * stub,
                    y: start.y + (dy / len) * stub,
                };
            } else if (dstPill) {
                end = trimToPill(srcP, dstP, dstPill.rw, dstPill.rh, dstPad);
            } else {
                continue;
            }

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
            // Quick-move highlight: true for any warp between the current
            // sector and a quick-move target, regardless of which direction
            // we ended up drawing. Two-ways come through the payload in both
            // directions and the dedupe picks whichever one iterates first —
            // checking only `from === currentId` misses cases where the
            // incoming edge won the dedupe race.
            const isQuickMoveWarp =
                (w.from_sector_id === currentId && quickMoveIndexById.has(w.to_sector_id)) ||
                (w.to_sector_id === currentId && quickMoveIndexById.has(w.from_sector_id));
            if (isQuickMoveWarp) {
                line.classList.add('minimap-warp--quick-move');
            }
            if (isTwoWay) {
                line.classList.add('minimap-warp--two-way');
                // Fringe stubs read better with an arrow pointing toward the
                // off-map target. Non-fringe two-ways stay arrowless — the
                // warp body alone is enough once both pills are visible.
                if (isFringe) {
                    line.setAttribute('marker-end', 'url(#arrTwoWay)');
                }
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
        // z-order safety net: if pills still visually overlap after collision
        // resolution, the most important ones stay readable. Background
        // sectors first, then adjacent out-warp targets, then the current
        // sector on top.
        const currentAdjSet = new Set<number>();
        for (const w of state.data.warps) {
            if (w.from_sector_id === currentId) currentAdjSet.add(w.to_sector_id);
        }
        const drawOrder = [...sectors].sort((a, b) => {
            const aPrio = a.id === currentId ? 2 : currentAdjSet.has(a.id) ? 1 : 0;
            const bPrio = b.id === currentId ? 2 : currentAdjSet.has(b.id) ? 1 : 0;
            return aPrio - bPrio;
        });
        for (const s of drawOrder) {
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
