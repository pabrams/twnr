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
            return `Sector ${sector.sector_number} (glimpsed)`;
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
        // Center the viewBox on the current sector (§5: "re-center on the new
        // current sector"). ViewSize is 2 × max reach from the pivot, so the
        // farthest visible sector sits at an edge and the current sector stays
        // dead-center regardless of exploration asymmetry.
        const pivotX = current?.x ?? (minX + maxX) / 2;
        const pivotY = current?.y ?? (minY + maxY) / 2;
        let maxReach = 0;
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            const dx = Math.abs(s.x - pivotX);
            const dy = Math.abs(s.y - pivotY);
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
            </marker>`;
        svg.appendChild(defs);

        // Pixel-space sizing: convert target on-screen pixel sizes into world
        // units using the panel's rendered width, so labels/nodes stay a
        // constant pixel size regardless of how far the player has explored.
        const panelPx = body.clientWidth || 320;
        const worldPerPx = viewSize / panelPx;
        const nodeR = 6 * worldPerPx;
        const currentR = 10 * worldPerPx;
        const labelSize = 12 * worldPerPx;
        const badgeSize = 9 * worldPerPx;
        const strokeW = 1.2 * worldPerPx;

        // Draw warps first so they sit behind nodes.
        const warpGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(warpGroup);
        // De-dupe bi-pairs: draw one line per undirected pair when known_two_way.
        const drawnBi = new Set<string>();
        for (const w of state.data.warps) {
            const src = byId.get(w.from_sector_id);
            const dst = byId.get(w.to_sector_id);
            if (!src || !dst) continue;
            if (src.x == null || src.y == null || dst.x == null || dst.y == null) continue;
            const srcVisited = src.visibility === 'visited';
            const dstVisited = dst.visibility === 'visited';
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', String(src.x));
            line.setAttribute('y1', String(src.y));
            line.setAttribute('x2', String(dst.x));
            line.setAttribute('y2', String(dst.y));
            line.setAttribute('stroke-width', String(strokeW));
            if (srcVisited && dstVisited && w.known_two_way) {
                const key = `${Math.min(w.from_sector_id, w.to_sector_id)}-${Math.max(w.from_sector_id, w.to_sector_id)}`;
                if (drawnBi.has(key)) continue;
                drawnBi.add(key);
                line.setAttribute('stroke', '#7af');
                line.setAttribute('stroke-linecap', 'round');
            } else if (srcVisited && dstVisited) {
                line.setAttribute('stroke', '#7af');
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('marker-end', 'url(#arr)');
            } else {
                // source visited, target glimpsed: dotted line with arrowhead
                line.setAttribute('stroke', '#667');
                line.setAttribute('stroke-dasharray', `${strokeW * 2} ${strokeW * 2}`);
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('marker-end', 'url(#arrDim)');
            }
            warpGroup.appendChild(line);
        }

        // Draw sector nodes. Labels are tracked so we can run a collision
        // pass after all nodes are placed.
        type LabelSlot = {
            label: SVGTextElement;
            sx: number;
            sy: number;
            r: number;
            hasBadgeBelow: boolean;
            text: string;
        };
        const labelSlots: LabelSlot[] = [];
        const nodeGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(nodeGroup);
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            const group = document.createElementNS(SVG_NS, 'g');
            group.classList.add('sector-node');
            group.setAttribute('transform', `translate(${s.x}, ${s.y})`);

            const isCurrent = s.id === currentId;
            const circle = document.createElementNS(SVG_NS, 'circle');
            if (isCurrent) {
                circle.setAttribute('r', String(currentR));
                circle.setAttribute('fill', '#ff0');
                circle.setAttribute('stroke', '#fff');
                circle.setAttribute('stroke-width', String(strokeW * 1.5));
            } else if (s.visibility === 'visited') {
                circle.setAttribute('r', String(nodeR));
                circle.setAttribute('fill', '#357');
                circle.setAttribute('stroke', '#9cf');
                circle.setAttribute('stroke-width', String(strokeW));
            } else {
                circle.setAttribute('r', String(nodeR * 0.85));
                circle.setAttribute('fill', 'none');
                circle.setAttribute('stroke', '#778');
                circle.setAttribute('stroke-width', String(strokeW * 0.8));
                circle.setAttribute('stroke-dasharray', `${strokeW} ${strokeW}`);
                // SVG fill="none" kills pointer events on the circle's
                // interior by default; force the whole area to be clickable
                // so glimpsed nodes can trigger autopilot (§6).
                circle.setAttribute('pointer-events', 'all');
            }
            group.appendChild(circle);

            const nr = isCurrent ? currentR : nodeR;
            const labelText = String(s.sector_number);
            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('y', String(-nr - labelSize * 0.3));
            label.setAttribute('font-size', String(labelSize));
            label.setAttribute('font-weight', isCurrent ? 'bold' : 'normal');
            label.setAttribute(
                'fill',
                isCurrent ? '#ff0' : s.visibility === 'visited' ? '#e0e0f0' : '#99a',
            );
            label.setAttribute('font-family', "'Courier New', Courier, monospace");
            label.textContent = labelText;
            group.appendChild(label);
            labelSlots.push({
                label,
                sx: s.x,
                sy: s.y,
                r: nr,
                hasBadgeBelow: s.visibility === 'visited' && s.port != null,
                text: labelText,
            });

            // Port badge (below the node) — visited only.
            if (s.visibility === 'visited' && s.port) {
                const triplet = PORT_CLASS_TRIPLET[s.port.class] ?? '???';
                const badgeY = (isCurrent ? currentR : nodeR) + badgeSize * 1.1;
                const bgWidth = badgeSize * 2.4;
                const bg = document.createElementNS(SVG_NS, 'rect');
                bg.setAttribute('x', String(-bgWidth / 2));
                bg.setAttribute('y', String(badgeY - badgeSize * 0.9));
                bg.setAttribute('width', String(bgWidth));
                bg.setAttribute('height', String(badgeSize * 1.2));
                bg.setAttribute('fill', '#000');
                bg.setAttribute('stroke', '#333');
                bg.setAttribute('stroke-width', String(strokeW * 0.5));
                group.appendChild(bg);
                // One <text> with three <tspan>s, green for B, cyan for S.
                const txt = document.createElementNS(SVG_NS, 'text');
                txt.setAttribute('text-anchor', 'middle');
                txt.setAttribute('y', String(badgeY));
                txt.setAttribute('font-size', String(badgeSize));
                txt.setAttribute('font-family', "'Courier New', Courier, monospace");
                txt.setAttribute('font-weight', 'bold');
                for (const ch of triplet) {
                    const span = document.createElementNS(SVG_NS, 'tspan');
                    span.textContent = ch;
                    span.setAttribute('fill', ch === 'B' ? '#4f4' : ch === 'S' ? '#4ff' : '#888');
                    txt.appendChild(span);
                }
                group.appendChild(txt);
            }

            // Planet glyph — visited only.
            if (s.visibility === 'visited' && s.planets.length > 0) {
                const planetGlyph = document.createElementNS(SVG_NS, 'text');
                planetGlyph.setAttribute('text-anchor', 'middle');
                planetGlyph.setAttribute('x', String((isCurrent ? currentR : nodeR) * 1.1));
                planetGlyph.setAttribute('y', String(-(isCurrent ? currentR : nodeR) * 0.4));
                planetGlyph.setAttribute('font-size', String(labelSize * 0.9));
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

        // Label collision resolution: greedy pass over all labels. For each,
        // estimate its world-space bbox at the default (above) position; if
        // it overlaps any already-placed label, try alternates (below, right,
        // left) and pick the first non-overlapping slot. Falls back to the
        // default position when all candidates collide.
        const placedRects: { x: number; y: number; w: number; h: number }[] = [];
        const charW = labelSize * 0.62;
        const pad = labelSize * 0.15;
        for (const slot of labelSlots) {
            const w = slot.text.length * charW + pad * 2;
            const h = labelSize + pad * 2;
            const half = w / 2;
            const above = {
                x: slot.sx - half,
                y: slot.sy - slot.r - labelSize - pad,
                w,
                h,
            };
            const below = {
                x: slot.sx - half,
                y: slot.sy + slot.r + pad,
                w,
                h,
            };
            const right = {
                x: slot.sx + slot.r * 1.2,
                y: slot.sy - h / 2,
                w,
                h,
            };
            const left = {
                x: slot.sx - slot.r * 1.2 - w,
                y: slot.sy - h / 2,
                w,
                h,
            };
            const candidates = slot.hasBadgeBelow
                ? [above, right, left]
                : [above, below, right, left];
            let chosen = above;
            for (const c of candidates) {
                let overlaps = false;
                for (const p of placedRects) {
                    if (c.x < p.x + p.w && c.x + c.w > p.x && c.y < p.y + p.h && c.y + c.h > p.y) {
                        overlaps = true;
                        break;
                    }
                }
                if (!overlaps) {
                    chosen = c;
                    break;
                }
            }
            if (chosen === above) {
                // already the default — no changes needed
            } else if (chosen === below) {
                slot.label.setAttribute('y', String(slot.r + labelSize * 0.95));
            } else if (chosen === right) {
                slot.label.setAttribute('text-anchor', 'start');
                slot.label.setAttribute('x', String(slot.r * 1.2));
                slot.label.setAttribute('y', String(labelSize * 0.35));
            } else if (chosen === left) {
                slot.label.setAttribute('text-anchor', 'end');
                slot.label.setAttribute('x', String(-slot.r * 1.2));
                slot.label.setAttribute('y', String(labelSize * 0.35));
            }
            placedRects.push(chosen);
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
