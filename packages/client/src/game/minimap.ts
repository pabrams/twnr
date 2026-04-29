import type { NeighborhoodResultObject, NeighborhoodSector } from '@twnr/shared';
import { colorPalette } from '../config/colors.js';
import './minimap.css';

/** Convert one of the palette entries to an `rgb(...)` CSS string. */
function rgb(c: { r: number; g: number; b: number }): string {
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

const COLORS = {
    sectorLabel: rgb(colorPalette.boldGreen),
    sep: rgb(colorPalette.boldYellow),
    sectorNumber: rgb(colorPalette.boldCyan),
    portLabel: rgb(colorPalette.magenta),
    portClass: rgb(colorPalette.boldCyan),
    portTripletParens: rgb(colorPalette.magenta),
    portTripletS: rgb(colorPalette.boldCyan),
    portTripletB: rgb(colorPalette.green),
    planetsLabel: rgb(colorPalette.magenta),
    planetCount: rgb(colorPalette.boldYellow),
    planetName: rgb(colorPalette.boldCyan),
    planetType: rgb(colorPalette.white),
    observedLabel: rgb(colorPalette.cyan),
    observedValue: rgb(colorPalette.yellow),
};

function span(text: string, color?: string): HTMLSpanElement {
    const s = document.createElement('span');
    s.textContent = text;
    if (color) s.style.color = color;
    return s;
}

type MinimapState = {
    depth: number;
    data: NeighborhoodResultObject | null;
    currentSectorNumber: number;
    quickMoveTargets: number[] | null;
    adminMode: boolean;
};

export type MinimapInjectionHandler = (sectorNumber: number, currentSector: number) => void;

export interface Minimap {
    update(data: NeighborhoodResultObject, currentSectorNumber: number): void;
    getDepth(): number;
    onRequestRefresh(handler: () => void): void;
    setQuickMove(targets: number[] | null): void;
    setAdminMode(adminMode: boolean): void;
}

const DEFAULT_DEPTH = 3;
const ADMIN_DEFAULT_DEPTH = 10;
const PLAYER_DEPTH_OPTIONS = [2, 3, 4, 5];
const ADMIN_DEPTH_OPTIONS = [3, 5, 10, 25, 50];

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
        adminMode: false,
    };

    const body = container.querySelector<HTMLElement>('.minimap-body')!;
    const svg = container.querySelector<SVGSVGElement>('.minimap-svg')!;
    const emptyState = container.querySelector<HTMLElement>('.empty-state')!;
    const infoPanel = container.querySelector<HTMLElement>('.minimap-info-panel')!;
    const header = container.querySelector<HTMLElement>('.minimap-header')!;

    let refreshHandler: (() => void) | null = null;

    function rebuildDepthButtons(): void {
        // Clear existing depth buttons but keep the "Depth:" label.
        for (const btn of Array.from(header.querySelectorAll('.depth-btn'))) btn.remove();
        const options = state.adminMode ? ADMIN_DEPTH_OPTIONS : PLAYER_DEPTH_OPTIONS;
        for (const depth of options) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'depth-btn';
            btn.dataset.depth = String(depth);
            btn.textContent = String(depth);
            if (depth === state.depth) btn.classList.add('active');
            btn.addEventListener('click', () => {
                if (depth === state.depth) return;
                state.depth = depth;
                for (const b of header.querySelectorAll<HTMLButtonElement>('.depth-btn')) {
                    b.classList.toggle('active', Number(b.dataset.depth) === depth);
                }
                refreshHandler?.();
            });
            header.appendChild(btn);
        }
    }

    rebuildDepthButtons();

    function setHoveredInfo(sector: NeighborhoodSector): void {
        renderInfoPanel(sector);
        infoPanel.classList.add('is-hovering');
    }
    function clearHoveredInfo(currentSector: NeighborhoodSector | undefined): void {
        renderInfoPanel(currentSector);
        infoPanel.classList.remove('is-hovering');
    }

    /**
     * Build the info panel as a body (scrollable) + footer (Observed line,
     * pinned to the bottom regardless of how much body content there is).
     */
    function renderInfoPanel(sector: NeighborhoodSector | undefined): void {
        infoPanel.replaceChildren();
        if (!sector) return;

        const body = document.createElement('div');
        body.className = 'info-body';

        body.appendChild(span('Sector', COLORS.sectorLabel));
        body.appendChild(span(' : ', COLORS.sep));
        body.appendChild(span(`${sector.sector_number}\n`, COLORS.sectorNumber));

        if (sector.visibility !== 'glimpsed') {
            if (sector.port) {
                const triplet = PORT_CLASS_TRIPLET[sector.port.class] ?? '???';
                body.appendChild(span('Port', COLORS.portLabel));
                body.appendChild(span(' : ', COLORS.sep));
                body.appendChild(span(`Class ${sector.port.class} `, COLORS.portClass));
                body.appendChild(span('(', COLORS.portTripletParens));
                for (const ch of triplet) {
                    if (ch === 'S') body.appendChild(span('S', COLORS.portTripletS));
                    else if (ch === 'B') body.appendChild(span('B', COLORS.portTripletB));
                    else body.appendChild(document.createTextNode(ch));
                }
                body.appendChild(span(')', COLORS.portTripletParens));
                body.appendChild(document.createTextNode('\n'));
            }
            if (sector.planets.length > 0) {
                body.appendChild(span('Planets', COLORS.planetsLabel));
                body.appendChild(span(' : ', COLORS.sep));
                body.appendChild(span(`${sector.planets.length}\n`, COLORS.planetCount));
                for (const p of sector.planets) {
                    body.appendChild(document.createTextNode('  • '));
                    body.appendChild(span(p.name, COLORS.planetName));
                    if (p.type) {
                        body.appendChild(document.createTextNode(' '));
                        body.appendChild(span(`(${p.type})`, COLORS.planetType));
                    }
                    body.appendChild(document.createTextNode('\n'));
                }
            }
        }
        infoPanel.appendChild(body);

        const latest = latestObservation(sector);
        if (latest) {
            const footer = document.createElement('div');
            footer.className = 'info-footer';
            footer.appendChild(span('Observed', COLORS.observedLabel));
            footer.appendChild(span(' : ', COLORS.sep));
            footer.appendChild(span(formatObserved(latest), COLORS.observedValue));
            infoPanel.appendChild(footer);
        }
    }

    /**
     * Most recent observation timestamp across the sector's port and planets.
     * Returns null if nothing's been observed (glimpsed-only sectors).
     */
    function latestObservation(sector: NeighborhoodSector): string | null {
        let latest: string | null = null;
        if (sector.port) latest = sector.port.observed_at;
        for (const p of sector.planets) {
            if (latest === null || p.observed_at > latest) latest = p.observed_at;
        }
        return latest;
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
            container.classList.add('is-hidden');
            return;
        }
        container.classList.remove('is-hidden');
        if (!state.data) {
            emptyState.classList.remove('is-hidden');
            emptyState.textContent = 'Loading map…';
            clearHoveredInfo(undefined);
            return;
        }
        if (state.data.sectors.length === 0) {
            emptyState.classList.remove('is-hidden');
            emptyState.textContent = 'No visited sectors yet — move to populate the map.';
            clearHoveredInfo(undefined);
            return;
        }
        emptyState.classList.add('is-hidden');

        const sectors = state.data.sectors;
        const currentId = state.data.current_sector_id;
        const byId = new Map<number, NeighborhoodSector>();
        for (const s of sectors) byId.set(s.id, s);
        const current = byId.get(currentId);

        clearHoveredInfo(current);

        // Quick-move: map each target sector_number (from the open move menu)
        // to its 1-based slot, and resolve those to sector_ids we can match
        // against adjacent warps
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

        const disp = new Map<number, { x: number; y: number }>();
        // Fringe sectors positions are used as direction vectors for warp stubs.
        const fringePos = new Map<number, { x: number; y: number }>();
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            if (s.fringe) {
                fringePos.set(s.id, { x: s.x, y: s.y });
                continue;
            }
            disp.set(s.id, { x: s.x, y: s.y });
        }

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
        // units using the panel's rendered width
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

        const warpGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(warpGroup);
        const drawnBi = new Set<string>();

        const warpLines: SVGLineElement[] = [];
        const pillRectsBySectorId = new Map<number, SVGRectElement>();
        const FRINGE_STUB_LEN_PX = 30;
        for (const w of state.data.warps) {
            const src = byId.get(w.from_sector_id);
            const dst = byId.get(w.to_sector_id);
            if (!src || !dst) continue;
            const srcP = disp.get(w.from_sector_id);
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
            const dstPad = isTwoWay ? strokeW * 0.5 : strokeW * 3;
            const srcPad = strokeW * 0.5;
            const start = trimToPill(dstP, srcP, srcPill.rw, srcPill.rh, srcPad);
            let end: { x: number; y: number };
            if (isFringe) {
                const dx = dstP.x - srcP.x;
                const dy = dstP.y - srcP.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const stub = FRINGE_STUB_LEN_PX * worldPerPx;
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
            // TODO: Do we need this?
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

            line.dataset.fromId = String(w.from_sector_id);
            line.dataset.toId = String(w.to_sector_id);
            if (isTwoWay) line.dataset.twoWay = 'true';
            warpLines.push(line);

            const isQuickMoveWarp =
                (w.from_sector_id === currentId && quickMoveIndexById.has(w.to_sector_id)) ||
                (w.to_sector_id === currentId && quickMoveIndexById.has(w.from_sector_id));
            if (isQuickMoveWarp) {
                line.classList.add('minimap-warp--quick-move');
            }
            if (isTwoWay) {
                line.classList.add('minimap-warp--two-way');
                if (isFringe) {
                    line.setAttribute('marker-end', 'url(#arrTwoWay)');
                }
            } else if (srcVisited && dstVisited) {
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

        const nodeGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(nodeGroup);

        // z-order: if pills still visually overlap after collision
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
            pillRectsBySectorId.set(s.id, rect);
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

            const hoverSectorId = s.id;
            const applyHoverHighlight = () => {
                rect.classList.add('minimap-sector-pill--hover-source');
                for (const line of warpLines) {
                    const fromId = Number(line.dataset.fromId);
                    const toId = Number(line.dataset.toId);
                    const twoWay = line.dataset.twoWay === 'true';
                    let otherId: number | null = null;
                    if (fromId === hoverSectorId) otherId = toId;
                    else if (twoWay && toId === hoverSectorId) otherId = fromId;
                    if (otherId === null) continue;
                    line.classList.add('minimap-warp--hover-out');
                    const targetRect = pillRectsBySectorId.get(otherId);
                    if (targetRect) targetRect.classList.add('minimap-sector-pill--hover-target');
                }
            };
            const clearHoverHighlight = () => {
                rect.classList.remove('minimap-sector-pill--hover-source');
                for (const line of warpLines) line.classList.remove('minimap-warp--hover-out');
                for (const r of pillRectsBySectorId.values()) {
                    r.classList.remove('minimap-sector-pill--hover-target');
                }
            };
            group.addEventListener('mouseenter', () => {
                setHoveredInfo(s);
                applyHoverHighlight();
            });
            group.addEventListener('mouseleave', () => {
                clearHoveredInfo(current);
                clearHoverHighlight();
            });
            group.addEventListener('click', () => {
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
        setAdminMode(adminMode) {
            if (state.adminMode === adminMode) return;
            state.adminMode = adminMode;
            container.classList.toggle('is-admin-mode', adminMode);
            // Pick a sensible default depth for the new mode if the current
            // depth isn't in the new option set. Caller is responsible for
            // triggering the next neighborhood fetch.
            const options = adminMode ? ADMIN_DEPTH_OPTIONS : PLAYER_DEPTH_OPTIONS;
            if (!options.includes(state.depth)) {
                state.depth = adminMode ? ADMIN_DEFAULT_DEPTH : DEFAULT_DEPTH;
            }
            rebuildDepthButtons();
        },
    };
}

export function flashTerminalBorder(termEl: HTMLElement, duration = 800): void {
    termEl.classList.add('flash-border');
    window.setTimeout(() => termEl.classList.remove('flash-border'), duration);
}
