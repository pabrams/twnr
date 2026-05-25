import type { NeighborhoodReply, NeighborhoodSector } from '@twnr/shared';
import { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER, portClassTriplet } from '@twnr/shared';
import { colorPalette, rgb } from '../config/colors.js';
import './minimap.css';

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
    zoom: number;
    data: NeighborhoodReply | null;
    currentSectorNumber: number;
    currentSectorId: number;
    quickMoveTargets: number[] | null;
    adminMode: boolean;
    /**
     * Viewport center in world units. null = "follow current sector"; the
     * server is told to center on the player. Set to a concrete world point
     * after the user zooms/pans away. Reset to null when the player moves to
     * a new sector.
     */
    viewportCenter: { x: number; y: number } | null;
    /** When true, pills show the port-triplet bottom half, planet glyphs, and
     *  observation icons (drones/mines/limpets). When false, pills collapse
     *  to just the sector number for a denser, less busy map. Persisted in
     *  localStorage. */
    extrasEnabled: boolean;
};

const EXTRAS_LS_KEY = 'twnr.minimap.extras';

function readExtrasPreference(): boolean {
    try {
        const v = localStorage.getItem(EXTRAS_LS_KEY);
        if (v === '0') return false;
    } catch {
        /* localStorage unavailable */
    }
    return true;
}

function writeExtrasPreference(enabled: boolean): void {
    try {
        localStorage.setItem(EXTRAS_LS_KEY, enabled ? '1' : '0');
    } catch {
        /* localStorage unavailable */
    }
}

export type MinimapInjectionHandler = (sectorNumber: number, currentSector: number) => void;
export type MinimapKeyInjector = (key: string) => void;

export type MinimapMenuButton = { label: string; key: string };

export interface Minimap {
    update(data: NeighborhoodReply, currentSectorNumber: number): void;
    /**
     * Viewport spec for the next neighborhood request. centerXWorld/Y are
     * undefined while the viewport is following the current sector; they
     * become concrete once the user zooms-toward-cursor or pans.
     */
    getViewport(): {
        halfWidthWorld: number;
        halfHeightWorld: number;
        centerXWorld?: number;
        centerYWorld?: number;
    };
    onRequestRefresh(handler: () => void): void;
    setQuickMove(targets: number[] | null): void;
    setAdminMode(adminMode: boolean): void;
    /** Pop up a floating button panel anchored to the minimap. Clicking a
     *  button injects its key via the supplied keyInjector (see
     *  createMinimap) and dismisses the panel. The panel also closes on
     *  closeMenu() — typically called when the player types in xterm. */
    openMenu(opts: { title?: string; buttons: MinimapMenuButton[] }): void;
    closeMenu(): void;
}

/**
 * Number of hex cells visible across the panel width at zoom = 1. Higher
 * zoom shows fewer cells (zoomed in); lower zoom shows more.
 */
const BASE_CELLS_ACROSS = 12;
/** Label/pill height as a fraction of one hex cell, in world units. */
const LABEL_FRACTION_OF_CELL = 0.45;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8.0;
const ZOOM_STEP = 1.15;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createMinimap(
    container: HTMLElement,
    onInject: MinimapInjectionHandler,
    onInjectKey: MinimapKeyInjector,
): Minimap {
    const state: MinimapState = {
        zoom: 1.0,
        data: null,
        currentSectorNumber: 0,
        currentSectorId: 0,
        quickMoveTargets: null,
        adminMode: false,
        viewportCenter: null,
        extrasEnabled: readExtrasPreference(),
    };

    const body = container.querySelector<HTMLElement>('.minimap-body')!;
    const svg = container.querySelector<SVGSVGElement>('.minimap-svg')!;
    const emptyState = container.querySelector<HTMLElement>('.empty-state')!;
    const infoPanel = container.querySelector<HTMLElement>('.minimap-info-panel')!;
    const header = container.querySelector<HTMLElement>('.minimap-header')!;

    let refreshHandler: (() => void) | null = null;

    const zoomReadout = document.createElement('span');
    zoomReadout.className = 'minimap-zoom-readout';
    header.appendChild(zoomReadout);
    function updateZoomReadout(): void {
        zoomReadout.textContent = `Zoom: ${Math.round(state.zoom * 100)}%`;
    }
    updateZoomReadout();

    function makeHeaderBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'minimap-action-btn';
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener('click', onClick);
        return btn;
    }

    header.appendChild(
        makeHeaderBtn('1×', 'Reset zoom (100%)', () => {
            if (Math.abs(state.zoom - 1) < 1e-4) return;
            state.zoom = 1;
            updateZoomReadout();
            refreshHandler?.();
        }),
    );
    header.appendChild(
        makeHeaderBtn('⌖', 'Center on current sector', () => {
            if (state.viewportCenter === null) return;
            state.viewportCenter = null;
            refreshHandler?.();
        }),
    );
    const extrasBtn = makeHeaderBtn('●●', '', () => {
        state.extrasEnabled = !state.extrasEnabled;
        writeExtrasPreference(state.extrasEnabled);
        updateExtrasBtn();
        render();
    });
    function updateExtrasBtn(): void {
        extrasBtn.textContent = state.extrasEnabled ? '●●' : '○○';
        extrasBtn.title = state.extrasEnabled
            ? 'Hide extras (port triplet, planet, drone/mine icons)'
            : 'Show extras (port triplet, planet, drone/mine icons)';
    }
    updateExtrasBtn();
    header.appendChild(extrasBtn);

    /**
     * Half-extents of the viewport in world units. At zoom = 1, the panel
     * width spans BASE_CELLS_ACROSS hex cells; height scales by aspect ratio.
     * Higher zoom = smaller bbox = fewer cells visible (and labels appear
     * larger because more pixels per cell). Center is the saved viewport
     * center if the user has zoomed/panned away from the player; otherwise
     * undefined, which tells the server to center on the current sector.
     */
    function computeViewport(): {
        halfWidthWorld: number;
        halfHeightWorld: number;
        centerXWorld?: number;
        centerYWorld?: number;
    } {
        const panelW = body.clientWidth || 320;
        const panelH = body.clientHeight || 320;
        const cellsAcross = BASE_CELLS_ACROSS / state.zoom;
        const worldWidth = cellsAcross * HEX_CELL_SIZE;
        const worldHeight = (worldWidth * panelH) / panelW;
        return {
            halfWidthWorld: worldWidth / 2,
            halfHeightWorld: worldHeight / 2,
            centerXWorld: state.viewportCenter?.x,
            centerYWorld: state.viewportCenter?.y,
        };
    }

    /**
     * Map a screen-space mouse event to its world-space coords inside the
     * SVG. Returns null if the event isn't over the SVG (so we fall back to
     * the current center). Linear inversion of the current viewBox.
     */
    function mouseToWorld(e: MouseEvent): { x: number; y: number } | null {
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const sx = (e.clientX - rect.left) / rect.width;
        const sy = (e.clientY - rect.top) / rect.height;
        if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return null;
        const vbAttr = svg.getAttribute('viewBox');
        if (!vbAttr) return null;
        const [vbx, vby, vbw, vbh] = vbAttr.split(/\s+/).map(Number);
        if (![vbx, vby, vbw, vbh].every(Number.isFinite)) return null;
        return { x: vbx + sx * vbw, y: vby + sy * vbh };
    }

    // Alt+wheel zooms toward the world point under the cursor (Google Maps
    // style): the pixel under the mouse stays put while everything else
    // scales around it. Ctrl+wheel browser zoom is independent.
    container.addEventListener(
        'wheel',
        (e: WheelEvent) => {
            if (!e.altKey) return;
            e.preventDefault();
            e.stopPropagation();
            const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
            if (Math.abs(next - state.zoom) < 1e-4) return;

            // Lock the world point under the cursor before changing zoom,
            // then shift the viewport center so that point stays under it.
            const worldUnder = mouseToWorld(e);
            const oldZoom = state.zoom;
            state.zoom = next;
            if (worldUnder) {
                // Find current viewport center: either the saved center, or
                // (if we're still following) the current sector's position.
                const oldCenter = state.viewportCenter ?? currentSectorWorld();
                if (oldCenter) {
                    const ratio = oldZoom / next;
                    state.viewportCenter = {
                        x: worldUnder.x + (oldCenter.x - worldUnder.x) * ratio,
                        y: worldUnder.y + (oldCenter.y - worldUnder.y) * ratio,
                    };
                }
            }
            updateZoomReadout();
            refreshHandler?.();
        },
        { passive: false },
    );

    // Middle-mouse drag pans the viewport. mousedown starts the gesture on
    // the panel; move/up listeners attach to the document so dragging
    // outside the panel still tracks. The center is updated locally on each
    // mousemove (immediate visual feedback). A throttled refresh fires
    // during drag so the server streams sectors into the new bbox while
    // panning — without this, pills don't appear until mouseup. A final
    // refresh on mouseup makes sure we end with up-to-date data.
    const PAN_REFRESH_MS = 150;
    let panState: { lastX: number; lastY: number } | null = null;
    let panRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    function schedulePanRefresh(): void {
        if (panRefreshTimer !== null) return;
        panRefreshTimer = setTimeout(() => {
            panRefreshTimer = null;
            refreshHandler?.();
        }, PAN_REFRESH_MS);
    }
    body.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 1) return;
        e.preventDefault();
        // Initialize viewportCenter from the current sector if we were still
        // "following the player" — otherwise the first pan tick has nothing
        // to shift.
        if (state.viewportCenter === null) {
            const cur = currentSectorWorld();
            if (cur) state.viewportCenter = { x: cur.x, y: cur.y };
            else return;
        }
        panState = { lastX: e.clientX, lastY: e.clientY };
        body.classList.add('is-panning');
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!panState || !state.viewportCenter) return;
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const vbAttr = svg.getAttribute('viewBox');
        if (!vbAttr) return;
        const [, , vbw, vbh] = vbAttr.split(/\s+/).map(Number);
        if (!Number.isFinite(vbw) || !Number.isFinite(vbh)) return;
        const dxPx = e.clientX - panState.lastX;
        const dyPx = e.clientY - panState.lastY;
        panState.lastX = e.clientX;
        panState.lastY = e.clientY;
        // Drag right -> see what's to the left -> camera moves left.
        state.viewportCenter = {
            x: state.viewportCenter.x - (dxPx * vbw) / rect.width,
            y: state.viewportCenter.y - (dyPx * vbh) / rect.height,
        };
        render();
        schedulePanRefresh();
    });
    document.addEventListener('mouseup', (e: MouseEvent) => {
        if (!panState) return;
        if (e.button !== 1) return;
        panState = null;
        body.classList.remove('is-panning');
        if (panRefreshTimer !== null) {
            clearTimeout(panRefreshTimer);
            panRefreshTimer = null;
        }
        refreshHandler?.();
    });

    /** World position of the player's current sector if we know it from the last payload. */
    function currentSectorWorld(): { x: number; y: number } | null {
        if (!state.data) return null;
        const cur = state.data.sectors.find((s) => s.id === state.data!.current_sector_id);
        if (!cur || cur.x == null || cur.y == null) return null;
        return { x: cur.x, y: cur.y };
    }

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
                const triplet = portClassTriplet(sector.port.class);
                body.appendChild(span('Port', COLORS.portLabel));
                body.appendChild(span(' : ', COLORS.sep));
                body.appendChild(span(`Class ${sector.port.class} `, COLORS.portClass));
                body.appendChild(span('(', COLORS.portTripletParens));
                if (triplet) {
                    for (const ch of triplet) {
                        if (ch === 'S') body.appendChild(span('S', COLORS.portTripletS));
                        else if (ch === 'B') body.appendChild(span('B', COLORS.portTripletB));
                    }
                } else {
                    body.appendChild(span('Special', COLORS.portClass));
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

        // ViewBox is the requested bbox centered on either the user's
        // saved viewport center (after zoom-toward-cursor) or the player's
        // current sector. If neither has a position, fall back to the bbox
        // of returned sectors.
        const viewport = computeViewport();
        const halfW = viewport.halfWidthWorld;
        const halfH = viewport.halfHeightWorld;
        let cxView: number;
        let cyView: number;
        if (state.viewportCenter) {
            cxView = state.viewportCenter.x;
            cyView = state.viewportCenter.y;
        } else if (current && current.x != null && current.y != null) {
            cxView = current.x;
            cyView = current.y;
        } else {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const s of sectors) {
                if (s.x == null || s.y == null) continue;
                if (s.x < minX) minX = s.x;
                if (s.x > maxX) maxX = s.x;
                if (s.y < minY) minY = s.y;
                if (s.y > maxY) maxY = s.y;
            }
            if (!Number.isFinite(minX)) {
                emptyState.classList.remove('is-hidden');
                emptyState.textContent = 'No positioned sectors in view.';
                return;
            }
            cxView = (minX + maxX) / 2;
            cyView = (minY + maxY) / 2;
        }

        // Bucket sectors by where they sit relative to the rendered viewport:
        //   - disp: anything inside the viewport gets a real pill, including
        //     in-bbox fringe (glimpsed) sectors which render with the
        //     existing dashed --glimpsed border.
        //   - fringePos: out-of-bbox fringe targets used as direction
        //     vectors only — they get clipped-to-edge stubs and an optional
        //     hover label, never a pill.
        const disp = new Map<number, { x: number; y: number }>();
        const fringePos = new Map<number, { x: number; y: number }>();
        const vbLeftPre = cxView - halfW;
        const vbRightPre = cxView + halfW;
        const vbTopPre = cyView - halfH;
        const vbBottomPre = cyView + halfH;
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            const inBbox =
                s.x >= vbLeftPre && s.x <= vbRightPre && s.y >= vbTopPre && s.y <= vbBottomPre;
            if (s.fringe && !inBbox) {
                fringePos.set(s.id, { x: s.x, y: s.y });
                continue;
            }
            disp.set(s.id, { x: s.x, y: s.y });
        }

        const viewSize = Math.max(halfW, halfH) * 2;
        svg.setAttribute(
            'viewBox',
            `${cxView - halfW} ${cyView - halfH} ${halfW * 2} ${halfH * 2}`,
        );
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const arrowHeadDefs = document.createElementNS(SVG_NS, 'defs');
        arrowHeadDefs.innerHTML = `
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
            </marker>
            <marker id="arrWormhole" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5"
                orient="auto-start-reverse">
              <path class="minimap-arrowhead--wormhole" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>`;
        svg.appendChild(arrowHeadDefs);

        // Sizes live in world units pinned to the hex-cell scale, so labels
        // and stroke width are a fixed fraction of a hex cell
        const panelPx = body.clientWidth || 320;
        const worldPerPx = viewSize / panelPx;
        const labelSize = HEX_CELL_SIZE * LABEL_FRACTION_OF_CELL;
        const strokeW = HEX_CELL_SIZE * 0.04;

        // Extras (port triplet / planet glyph / observation icons) only appear
        // on visited sectors and only when the toggle is enabled. The bottom-
        // half is added to total pill height (so warps trim around the full
        // box). 3-char triplet drives the minimum width when extras are on.
        const BOTTOM_HALF_FONT_RATIO = 0.7;
        function pillDims(s: NeighborhoodSector): {
            rw: number;
            topRh: number;
            bottomRh: number;
            totalRh: number;
            fontPx: number;
            bottomFontPx: number;
        } {
            const isCurrent = s.id === currentId;
            const fontPx = isCurrent ? labelSize * 1.2 : labelSize;
            const cw = fontPx * 0.62;
            const px = fontPx * 0.5;
            const py = fontPx * 0.3;
            const showExtras = state.extrasEnabled && s.visibility === 'visited';
            const bottomFontPx = fontPx * BOTTOM_HALF_FONT_RATIO;
            const bottomCw = bottomFontPx * 0.62;
            const minLabelWidth = String(s.sector_number).length * cw;
            const minTripletWidth = showExtras ? 3 * bottomCw : 0;
            const rw = Math.max(minLabelWidth, minTripletWidth) + px * 2;
            const topRh = fontPx + py * 2;
            const bottomRh = showExtras ? bottomFontPx + py * 1.4 : 0;
            return { rw, topRh, bottomRh, totalRh: topRh + bottomRh, fontPx, bottomFontPx };
        }

        // Precompute pill bounds so warp lines can be trimmed to each pill's
        // edge, leaving arrowheads visible outside the destination pill.
        const pillById = new Map<number, { rw: number; rh: number }>();
        for (const s of sectors) {
            if (!disp.has(s.id)) continue;
            const { rw, totalRh } = pillDims(s);
            pillById.set(s.id, { rw, rh: totalRh });
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

        const warpGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(warpGroup);
        // Top-of-z overlay for hover-only end-labels
        const overlayGroup = document.createElementNS(SVG_NS, 'g');
        const drawnBi = new Set<string>();

        const warpLines: SVGLineElement[] = [];
        const pillRectsBySectorId = new Map<number, SVGRectElement>();
        // For each visited source sector that has wormhole(s) leading off the
        // panel, an end-label pill (hidden by default) sits at the line's
        // clipped endpoint, and shows the destination sector_number on
        // hover. Keyed by source-sector id so multiple offscreen wormholes
        // from the same source all light up together.
        const endLabelsBySrcId = new Map<number, SVGGElement[]>();
        // Distance threshold for "wormhole". With flat-top hex `size =
        // HEX_CELL_SIZE` and spacing multiplied by HEX_SPACING_MULTIPLIER,
        // adjacent center-to-center distance is √3 × HEX_CELL_SIZE × M and
        // the closest non-adjacent pair sits at 3 × HEX_CELL_SIZE × M. A
        // threshold of 2 × HEX_CELL_SIZE × M cleanly separates locals from
        // any long-range wormhole.
        const WORMHOLE_DIST_SQ = (HEX_CELL_SIZE * 2 * HEX_SPACING_MULTIPLIER) ** 2;
        const vbLeft = cxView - halfW;
        const vbRight = cxView + halfW;
        const vbTop = cyView - halfH;
        const vbBottom = cyView + halfH;
        const inViewBox = (p: { x: number; y: number }): boolean =>
            p.x >= vbLeft && p.x <= vbRight && p.y >= vbTop && p.y <= vbBottom;
        // Clip a ray (start, dir) to the rendered viewBox; returns the exit
        // point with a small inset so the arrowhead sits inside the panel.
        const insetWorldPx = HEX_CELL_SIZE * 0.05;
        function clipToViewBox(
            startPt: { x: number; y: number },
            dir: { x: number; y: number },
        ): { x: number; y: number } {
            let tMax = Infinity;
            if (dir.x > 1e-9) tMax = Math.min(tMax, (vbRight - startPt.x) / dir.x);
            else if (dir.x < -1e-9) tMax = Math.min(tMax, (vbLeft - startPt.x) / dir.x);
            if (dir.y > 1e-9) tMax = Math.min(tMax, (vbBottom - startPt.y) / dir.y);
            else if (dir.y < -1e-9) tMax = Math.min(tMax, (vbTop - startPt.y) / dir.y);
            if (!Number.isFinite(tMax) || tMax <= 0) return startPt;
            const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
            const insetT = insetWorldPx / dirLen;
            const t = Math.max(0, tMax - insetT);
            return { x: startPt.x + dir.x * t, y: startPt.y + dir.y * t };
        }

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
            const srcOnscreen = inViewBox(srcP);
            const dstOnscreen = inViewBox(dstP);
            // Suppress warps whose source is off-screen. Without this, the
            // "extend to viewBox edge" treatment for off-screen targets
            // produces ghost lines that cut across the panel from a source
            // we can't even see — particularly noticeable mid-drag when
            // pan moves loaded data outside the new viewport.
            if (!srcOnscreen) continue;
            const dxFull = dstP.x - srcP.x;
            const dyFull = dstP.y - srcP.y;
            const distSq = dxFull * dxFull + dyFull * dyFull;
            // Wormhole label: visited→visited long-range edge. Glimpsed
            // targets keep their existing magenta-dotted styling regardless.
            // Wormhole-ness is a property of the edge geometry (long-range),
            // not target visibility — a wormhole to an unvisited sector is
            // still a wormhole and should render in dark yellow.
            const isWormhole = srcVisited && distSq > WORMHOLE_DIST_SQ;
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
            if (!dstOnscreen) {
                // Target outside the viewBox — extend the line to the panel
                // edge so the user sees there's an outgoing warp + which
                // direction it goes. Used for wormholes (dark-yellow dotted)
                // and for long-range glimpsed warps (magenta dotted).
                end = clipToViewBox(start, { x: dxFull, y: dyFull });
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
            if (isWormhole) {
                // Long-range edge — dark yellow regardless of target
                // visibility. Dotted + arrowhead when the far end is
                // off-screen so it's clear this isn't a local hop. Wins
                // over the glimpsed-target style; a wormhole to an
                // unvisited sector still reads as a wormhole.
                if (!dstOnscreen) {
                    line.classList.add('minimap-warp--wormhole-stub');
                    line.setAttribute('stroke-dasharray', `${strokeW * 2} ${strokeW * 2}`);
                    line.setAttribute('marker-end', 'url(#arrWormhole)');
                } else {
                    line.classList.add('minimap-warp--wormhole');
                    if (!isTwoWay) line.setAttribute('marker-end', 'url(#arrWormhole)');
                }
            } else if (!srcVisited || !dstVisited) {
                // Local edge to a glimpsed target: dotted with the dim
                // arrowhead. (Wormholes to glimpsed targets were handled
                // above.)
                line.classList.add('minimap-warp--unexplored');
                line.setAttribute('stroke-dasharray', `${strokeW * 2} ${strokeW * 2}`);
                line.setAttribute('marker-end', 'url(#arrDim)');
            } else if (isTwoWay) {
                line.classList.add('minimap-warp--two-way');
                if (isFringe || !dstOnscreen) {
                    line.setAttribute('marker-end', 'url(#arrTwoWay)');
                }
            } else {
                line.classList.add('minimap-warp--one-way-confirmed');
                line.setAttribute('marker-end', 'url(#arrRed)');
                if (!dstOnscreen) {
                    line.setAttribute('stroke-dasharray', `${strokeW * 2} ${strokeW * 2}`);
                }
            }
            warpGroup.appendChild(line);

            // Hover-only end-label: shows the destination sector_number for
            // any warp that exits the panel, so the user can identify each
            // out-warp without clicking. Two visual variants:
            //   - --visited: dark yellow (target is a known sector)
            //   - --glimpsed: magenta (target is unvisited / fringe)
            // Positioned a hair inside the screen edge along the warp's
            // direction so the pill is fully visible.
            if (!dstOnscreen) {
                const ldx = end.x - start.x;
                const ldy = end.y - start.y;
                const llen = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
                const labelInset = HEX_CELL_SIZE * 0.6;
                const labelX = end.x - (ldx / llen) * labelInset;
                const labelY = end.y - (ldy / llen) * labelInset;

                const labelGroup = document.createElementNS(SVG_NS, 'g');
                labelGroup.classList.add('minimap-warp-end-label');
                labelGroup.classList.add(
                    dstVisited
                        ? 'minimap-warp-end-label--visited'
                        : 'minimap-warp-end-label--glimpsed',
                );
                labelGroup.setAttribute('transform', `translate(${labelX}, ${labelY})`);

                const dstNum = String(dst.sector_number);
                const fontPx = labelSize * 0.95;
                const cw = fontPx * 0.62;
                const ppx = fontPx * 0.45;
                const ppy = fontPx * 0.28;
                const lrw = dstNum.length * cw + ppx * 2;
                const lrh = fontPx + ppy * 2;
                const lrx = fontPx * 0.3;

                const lrect = document.createElementNS(SVG_NS, 'rect');
                lrect.setAttribute('x', String(-lrw / 2));
                lrect.setAttribute('y', String(-lrh / 2));
                lrect.setAttribute('width', String(lrw));
                lrect.setAttribute('height', String(lrh));
                lrect.setAttribute('rx', String(lrx));
                lrect.setAttribute('ry', String(lrx));
                lrect.setAttribute('stroke-width', String(strokeW));
                labelGroup.appendChild(lrect);

                const ltext = document.createElementNS(SVG_NS, 'text');
                ltext.classList.add('minimap-warp-end-label-text');
                ltext.setAttribute('text-anchor', 'middle');
                ltext.setAttribute('dominant-baseline', 'central');
                ltext.setAttribute('font-size', String(fontPx));
                ltext.textContent = dstNum;
                labelGroup.appendChild(ltext);

                // Quick-move target sitting off-screen: keep the label
                // always-visible (not hover-only) while the move menu is
                // open, and tack on the same green numbered badge the
                // on-screen quick-move pills show.
                const qIdx = isQuickMoveWarp ? quickMoveIndexById.get(w.to_sector_id) : undefined;
                if (qIdx !== undefined) {
                    labelGroup.classList.add('minimap-warp-end-label--quick-move');
                    const badgeR = fontPx * 0.65;
                    const badgeY = lrh / 2 + badgeR + fontPx * 0.25;
                    const badgeCircle = document.createElementNS(SVG_NS, 'circle');
                    badgeCircle.classList.add('minimap-quick-move-badge');
                    badgeCircle.setAttribute('cx', '0');
                    badgeCircle.setAttribute('cy', String(badgeY));
                    badgeCircle.setAttribute('r', String(badgeR));
                    badgeCircle.setAttribute('stroke-width', String(strokeW));
                    labelGroup.appendChild(badgeCircle);
                    const badgeText = document.createElementNS(SVG_NS, 'text');
                    badgeText.classList.add('minimap-quick-move-badge-text');
                    badgeText.setAttribute('text-anchor', 'middle');
                    badgeText.setAttribute('dominant-baseline', 'central');
                    badgeText.setAttribute('x', '0');
                    badgeText.setAttribute('y', String(badgeY));
                    badgeText.setAttribute('font-size', String(fontPx * 0.95));
                    badgeText.textContent = String(qIdx);
                    labelGroup.appendChild(badgeText);
                }

                overlayGroup.appendChild(labelGroup);
                if (!endLabelsBySrcId.has(w.from_sector_id)) {
                    endLabelsBySrcId.set(w.from_sector_id, []);
                }
                endLabelsBySrcId.get(w.from_sector_id)!.push(labelGroup);
            }
        }

        const nodeGroup = document.createElementNS(SVG_NS, 'g');
        svg.appendChild(nodeGroup);
        // Hover labels go on top of everything else.
        svg.appendChild(overlayGroup);

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
            const { rw, topRh, bottomRh, totalRh, fontPx, bottomFontPx } = pillDims(s);
            const rx = fontPx * 0.35;
            const labelY = -bottomRh / 2;

            const group = document.createElementNS(SVG_NS, 'g');
            group.classList.add('sector-node');
            group.setAttribute('transform', `translate(${p.x}, ${p.y})`);

            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('x', String(-rw / 2));
            rect.setAttribute('y', String(-totalRh / 2));
            rect.setAttribute('width', String(rw));
            rect.setAttribute('height', String(totalRh));
            rect.setAttribute('rx', String(rx));
            rect.setAttribute('ry', String(rx));
            // Uniform border around the whole pill — same width and color
            // for current and visited so the perimeter reads as one shape.
            // Glimpsed keeps its dashed look as the "not-yet-visited" hint.
            if (isCurrent) {
                rect.classList.add('minimap-sector-pill--current');
                rect.setAttribute('stroke-width', String(strokeW));
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

            // Pill interior is uniformly black (see CSS); a thin divider
            // line separates the sector-number half from the port-triplet
            // half. Same stroke width as the outer border so the whole
            // pill looks like one consistent frame.
            if (bottomRh > 0) {
                const dividerY = (topRh - bottomRh) / 2;
                const divider = document.createElementNS(SVG_NS, 'line');
                divider.classList.add('minimap-sector-pill-divider');
                divider.setAttribute('x1', String(-rw / 2));
                divider.setAttribute('x2', String(rw / 2));
                divider.setAttribute('y1', String(dividerY));
                divider.setAttribute('y2', String(dividerY));
                divider.setAttribute('stroke-width', String(strokeW));
                group.appendChild(divider);

                if (s.port) {
                    const triplet = portClassTriplet(s.port.class);
                    const bandCenterY = topRh / 2;
                    if (triplet) {
                        const bottomCw = bottomFontPx * 0.62;
                        for (let i = 0; i < triplet.length; i++) {
                            const ch = triplet[i];
                            const t = document.createElementNS(SVG_NS, 'text');
                            t.classList.add('minimap-port-triplet');
                            if (ch === 'S') t.classList.add('minimap-port-triplet--sell');
                            else if (ch === 'B') t.classList.add('minimap-port-triplet--buy');
                            t.setAttribute('text-anchor', 'middle');
                            t.setAttribute('dominant-baseline', 'central');
                            t.setAttribute('font-size', String(bottomFontPx));
                            t.setAttribute(
                                'x',
                                String(bottomCw * (i - (triplet.length - 1) / 2)),
                            );
                            t.setAttribute('y', String(bandCenterY));
                            t.textContent = ch;
                            group.appendChild(t);
                        }
                    } else {
                        const t = document.createElementNS(SVG_NS, 'text');
                        t.classList.add('minimap-port-triplet');
                        t.setAttribute('text-anchor', 'middle');
                        t.setAttribute('dominant-baseline', 'central');
                        t.setAttribute('font-size', String(bottomFontPx));
                        t.setAttribute('x', '0');
                        t.setAttribute('y', String(bandCenterY));
                        t.textContent = `C${s.port.class}`;
                        group.appendChild(t);
                    }
                }
            }

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
            label.setAttribute('y', String(labelY));
            label.textContent = labelText;
            group.appendChild(label);

            if (
                state.extrasEnabled &&
                s.visibility === 'visited' &&
                s.planets.length > 0
            ) {
                const planetGlyph = document.createElementNS(SVG_NS, 'text');
                planetGlyph.classList.add('minimap-planet-glyph');
                planetGlyph.setAttribute('text-anchor', 'start');
                planetGlyph.setAttribute('x', String(rw / 2 - fontPx * 0.15));
                planetGlyph.setAttribute('y', String(-totalRh / 2 - fontPx * 0.15));
                planetGlyph.setAttribute('font-size', String(fontPx * 0.9));
                planetGlyph.textContent = '◉';
                group.appendChild(planetGlyph);
            }

            // Observation icons (drones/mines/limpets). Three corners are
            // already in use: planets sit just above the top-right; quick-move
            // badges hang below the bottom-center; sector_number occupies the
            // top half. We tuck:
            //   drones  → top-left, just outside the pill
            //   mines   → bottom-left, just outside the pill
            //   limpets → bottom-right, just outside the pill (letter L)
            const obs = s.observations;
            if (state.extrasEnabled && s.visibility === 'visited' && obs) {
                const iconFontPx = fontPx * 0.7;
                const offset = fontPx * 0.15;
                if (obs.friendlyDrones || obs.enemyDrones) {
                    const cls = obs.friendlyDrones
                        ? 'minimap-obs-icon--friendly'
                        : 'minimap-obs-icon--enemy';
                    const t = document.createElementNS(SVG_NS, 'text');
                    t.classList.add('minimap-obs-icon', cls);
                    t.setAttribute('text-anchor', 'end');
                    t.setAttribute('dominant-baseline', 'alphabetic');
                    t.setAttribute('x', String(-rw / 2 + iconFontPx * 0.5));
                    t.setAttribute('y', String(-totalRh / 2 - offset));
                    t.setAttribute('font-size', String(iconFontPx));
                    t.textContent = '▲';
                    group.appendChild(t);
                }
                if (obs.friendlyProxMines || obs.enemyProxMines) {
                    const cls = obs.friendlyProxMines
                        ? 'minimap-obs-icon--friendly'
                        : 'minimap-obs-icon--enemy';
                    const t = document.createElementNS(SVG_NS, 'text');
                    t.classList.add('minimap-obs-icon', cls);
                    t.setAttribute('text-anchor', 'end');
                    t.setAttribute('dominant-baseline', 'hanging');
                    t.setAttribute('x', String(-rw / 2 + iconFontPx * 0.5));
                    t.setAttribute('y', String(totalRh / 2 + offset * 0.2));
                    t.setAttribute('font-size', String(iconFontPx));
                    t.textContent = '✱';
                    group.appendChild(t);
                }
                if (obs.friendlySeekerMines) {
                    const t = document.createElementNS(SVG_NS, 'text');
                    t.classList.add('minimap-obs-icon', 'minimap-obs-icon--friendly');
                    t.setAttribute('text-anchor', 'start');
                    t.setAttribute('dominant-baseline', 'hanging');
                    t.setAttribute('x', String(rw / 2 - iconFontPx * 0.5));
                    t.setAttribute('y', String(totalRh / 2 + offset * 0.2));
                    t.setAttribute('font-size', String(iconFontPx));
                    t.textContent = 'L';
                    group.appendChild(t);
                }
            }

            if (quickMoveIndex !== undefined) {
                const badgeR = fontPx * 0.65;
                const badgeY = totalRh / 2 + badgeR + fontPx * 0.25;
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
                const labels = endLabelsBySrcId.get(hoverSectorId);
                if (labels) for (const l of labels) l.classList.add('is-visible');
            };
            const clearHoverHighlight = () => {
                rect.classList.remove('minimap-sector-pill--hover-source');
                for (const line of warpLines) line.classList.remove('minimap-warp--hover-out');
                for (const r of pillRectsBySectorId.values()) {
                    r.classList.remove('minimap-sector-pill--hover-target');
                }
                const labels = endLabelsBySrcId.get(hoverSectorId);
                if (labels) for (const l of labels) l.classList.remove('is-visible');
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

    // Floating context-style menu, anchored near the last known mouse
    // position over the minimap (typically wherever the player just
    // clicked). Vertical list — closest to the OS right-click menu the
    // player already expects. Buttons inject keys via onInjectKey;
    // closeMenu() also dismisses it.
    let menuEl: HTMLElement | null = null;
    let lastMouseX: number | null = null;
    let lastMouseY: number | null = null;
    container.addEventListener('mousemove', (e: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        lastMouseX = e.clientX - rect.left;
        lastMouseY = e.clientY - rect.top;
    });
    function destroyMenu(): void {
        if (menuEl) {
            menuEl.remove();
            menuEl = null;
        }
    }
    function buildMenu(title: string | undefined, items: MinimapMenuButton[]): HTMLElement {
        const el = document.createElement('div');
        el.className = 'minimap-menu';
        if (title) {
            const h = document.createElement('div');
            h.className = 'minimap-menu-title';
            h.textContent = title;
            el.appendChild(h);
        }
        for (const b of items) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'minimap-menu-item';
            item.textContent = b.label;
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                destroyMenu();
                onInjectKey(b.key);
            });
            el.appendChild(item);
        }
        return el;
    }
    function positionMenu(el: HTMLElement): void {
        const rect = container.getBoundingClientRect();
        const margin = 4;
        // Append first so we can measure the menu's own dimensions.
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const anchorX = lastMouseX ?? rect.width / 2;
        const anchorY = lastMouseY ?? rect.height / 2;
        // Place slightly to the right/below the cursor like a native context
        // menu; clamp to keep it fully inside the container.
        let x = anchorX + 2;
        let y = anchorY + 2;
        if (x + w + margin > rect.width) x = Math.max(margin, anchorX - w - 2);
        if (y + h + margin > rect.height) y = Math.max(margin, anchorY - h - 2);
        x = Math.max(margin, Math.min(rect.width - w - margin, x));
        y = Math.max(margin, Math.min(rect.height - h - margin, y));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }

    return {
        update(data, currentSectorNumber) {
            // When the player moves to a new sector, drop any cursor-zoom
            // pan offset so the viewport snaps back to following the player.
            // We detect this by comparing the data's current_sector_id to
            // the last one we rendered.
            if (state.currentSectorId !== 0 && state.currentSectorId !== data.current_sector_id) {
                state.viewportCenter = null;
            }
            state.data = data;
            state.currentSectorNumber = currentSectorNumber;
            state.currentSectorId = data.current_sector_id;
            render();
        },
        getViewport() {
            return computeViewport();
        },
        onRequestRefresh(handler) {
            refreshHandler = handler;
        },
        setQuickMove(targets) {
            const hasTargets = !!(targets && targets.length > 0);
            state.quickMoveTargets = hasTargets ? [...targets] : null;
            // Opening the move menu (M): recenter on the player.
            if (hasTargets && state.viewportCenter !== null) {
                state.viewportCenter = null;
                refreshHandler?.();
            }
            render();
        },
        setAdminMode(adminMode) {
            if (state.adminMode === adminMode) return;
            state.adminMode = adminMode;
            container.classList.toggle('is-admin-mode', adminMode);
        },
        openMenu(opts) {
            destroyMenu();
            menuEl = buildMenu(opts.title, opts.buttons);
            container.appendChild(menuEl);
            positionMenu(menuEl);
        },
        closeMenu() {
            destroyMenu();
        },
    };
}

export function flashTerminalBorder(termEl: HTMLElement, duration = 800): void {
    termEl.classList.add('flash-border');
    window.setTimeout(() => termEl.classList.remove('flash-border'), duration);
}
