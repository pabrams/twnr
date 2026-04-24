import type { NeighborhoodResultObject, NeighborhoodSector } from '@twnr/shared';

type MinimapState = {
    depth: number;
    data: NeighborhoodResultObject | null;
    currentSectorNumber: number;
};

export type MinimapInjectionHandler = (sectorNumber: number, currentSector: number) => void;

export interface Minimap {
    /** Update with a NEIGHBORHOOD result from the server. */
    update(data: NeighborhoodResultObject, currentSectorNumber: number): void;
    /** Current hop-depth (for refetching). */
    getDepth(): number;
    /** Register a handler invoked on every redraw request, e.g. to refetch. */
    onRequestRefresh(handler: () => void): void;
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
        tooltip.style.display = 'block';
        const rect = body.getBoundingClientRect();
        const x = Math.min(evt.clientX - rect.left + 10, rect.width - 230);
        const y = Math.min(evt.clientY - rect.top + 10, rect.height - 80);
        tooltip.style.left = Math.max(4, x) + 'px';
        tooltip.style.top = Math.max(4, y) + 'px';
    }
    function hideTooltip(): void {
        tooltip.style.display = 'none';
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
            container.style.display = 'none';
            return;
        }
        container.style.display = '';
        if (!state.data) {
            emptyState.style.display = 'flex';
            emptyState.textContent = 'Loading map…';
            return;
        }
        if (state.data.sectors.length === 0) {
            emptyState.style.display = 'flex';
            emptyState.textContent = 'No visited sectors yet — move to populate the map.';
            return;
        }
        emptyState.style.display = 'none';

        const sectors = state.data.sectors;
        const currentId = state.data.current_sector_id;
        const byId = new Map<number, NeighborhoodSector>();
        for (const s of sectors) byId.set(s.id, s);
        const current = byId.get(currentId);

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
            emptyState.style.display = 'flex';
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
        const ANCHOR = 0.04;
        const ITERS = 100;
        for (let iter = 0; iter < ITERS; iter++) {
            const cool = 1 - iter / ITERS;
            for (let i = 0; i < dispN; i++) {
                const a = disp.get(dispIds[i])!;
                for (let j = i + 1; j < dispN; j++) {
                    const b = disp.get(dispIds[j])!;
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
                    if (d2 < targetSpacing * targetSpacing) {
                        const d = Math.sqrt(d2);
                        const push = (targetSpacing - d) * 0.5 * cool;
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
                p.x += (p.ox - p.x) * ANCHOR;
                p.y += (p.oy - p.y) * ANCHOR;
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
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#c0c0c0" />
            </marker>
            <marker id="arrDim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5"
                orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#667" />
            </marker>
            <marker id="arrRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5"
                orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#f55" />
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

            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', String(start.x));
            line.setAttribute('y1', String(start.y));
            line.setAttribute('x2', String(end.x));
            line.setAttribute('y2', String(end.y));
            line.setAttribute('stroke-width', String(strokeW));
            if (isTwoWay) {
                line.setAttribute('stroke', '#7af');
                line.setAttribute('stroke-linecap', 'round');
            } else if (srcVisited && dstVisited) {
                // Both endpoints visited but reverse warp absent from the
                // universe — confirmed one-way. Draw in red with arrowhead.
                line.setAttribute('stroke', '#f55');
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('marker-end', 'url(#arrRed)');
            } else {
                // source visited, target glimpsed: dotted line with arrowhead
                line.setAttribute('stroke', '#667');
                line.setAttribute('stroke-dasharray', `${strokeW * 2} ${strokeW * 2}`);
                line.setAttribute('stroke-linecap', 'round');
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
                rect.setAttribute('fill', '#ff0');
                rect.setAttribute('stroke', '#fff');
                rect.setAttribute('stroke-width', String(strokeW * 1.5));
            } else if (s.visibility === 'visited') {
                rect.setAttribute('fill', '#357');
                rect.setAttribute('stroke', '#9cf');
                rect.setAttribute('stroke-width', String(strokeW));
            } else {
                rect.setAttribute('fill', 'none');
                rect.setAttribute('stroke', '#778');
                rect.setAttribute('stroke-width', String(strokeW * 0.8));
                rect.setAttribute('stroke-dasharray', `${strokeW} ${strokeW}`);
                // fill="none" kills pointer events on the rect's interior;
                // force the whole area clickable so glimpsed nodes can
                // trigger autopilot.
                rect.setAttribute('pointer-events', 'all');
            }
            group.appendChild(rect);

            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('dominant-baseline', 'central');
            label.setAttribute('font-size', String(fontPx));
            label.setAttribute('font-weight', isCurrent ? 'bold' : 'normal');
            label.setAttribute(
                'fill',
                isCurrent ? '#000' : s.visibility === 'visited' ? '#e0e0f0' : '#aab',
            );
            label.setAttribute('font-family', "'Courier New', Courier, monospace");
            label.setAttribute('pointer-events', 'none');
            label.textContent = labelText;
            group.appendChild(label);

            // Planet glyph — visited only. Sits just above the pill's
            // top-right corner so it doesn't compete with the number.
            if (s.visibility === 'visited' && s.planets.length > 0) {
                const planetGlyph = document.createElementNS(SVG_NS, 'text');
                planetGlyph.setAttribute('text-anchor', 'start');
                planetGlyph.setAttribute('x', String(rw / 2 - fontPx * 0.15));
                planetGlyph.setAttribute('y', String(-rh / 2 - fontPx * 0.15));
                planetGlyph.setAttribute('font-size', String(fontPx * 0.9));
                planetGlyph.setAttribute('fill', '#fc6');
                planetGlyph.textContent = s.planets.length > 1 ? `◉${s.planets.length}` : '◉';
                group.appendChild(planetGlyph);
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
    };
}

/** Apply a short border-flash animation to the terminal element. */
export function flashTerminalBorder(termEl: HTMLElement, duration = 800): void {
    termEl.classList.add('flash-border');
    window.setTimeout(() => termEl.classList.remove('flash-border'), duration);
}
