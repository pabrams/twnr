import type { NeighborhoodReply, NeighborhoodSector, NeighborhoodWarp } from '@twnr/shared';
import { HEX_CELL_SIZE, HEX_SPACING_MULTIPLIER, portClassTriplet } from '@twnr/shared';
import { colorPalette, rgb } from '../config/colors.js';
import './minimap.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

const BASE_CELLS_ACROSS = 12;
const LABEL_FRACTION_OF_CELL = 0.45;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8.0;
const ZOOM_STEP = 1.15;
const PAN_REFRESH_MS = 150;
const BOTTOM_HALF_FONT_RATIO = 0.7;
const EXTRAS_LS_KEY = 'twnr.minimap.extras';

/** Wormhole edge threshold: adjacent hex centres sit √3 apart (in scaled cell units), closest non-adjacent at 3; 2 separates them cleanly. */
const WORMHOLE_DIST_SQ = (HEX_CELL_SIZE * 2 * HEX_SPACING_MULTIPLIER) ** 2;

type Pt = { x: number; y: number };

type ClassSpec = string | (string | false | undefined)[] | undefined;
type Attrs = Record<string, string | number>;

function applyClasses(el: Element, classes: ClassSpec): void {
    if (typeof classes === 'string') el.classList.add(classes);
    else if (classes) for (const c of classes) if (c) el.classList.add(c);
}

function svgEl<K extends keyof SVGElementTagNameMap>(
    tag: K,
    classes?: ClassSpec,
    attrs?: Attrs,
): SVGElementTagNameMap[K] {
    const el = document.createElementNS(SVG_NS, tag);
    applyClasses(el, classes);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

function svgText(classes: ClassSpec, attrs: Attrs, text: string): SVGTextElement {
    const t = svgEl('text', classes, {
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        ...attrs,
    });
    t.textContent = text;
    return t;
}

function span(text: string, className?: string): HTMLSpanElement {
    const s = document.createElement('span');
    s.textContent = text;
    if (className) s.className = className;
    return s;
}

/** SVG paints in document order: re-append raises `el`; the returned restore fns must run in reverse raise order. */
function raiseToFront(el: Element): () => void {
    const parent = el.parentNode;
    if (!parent) return () => {};
    const next = el.nextSibling;
    parent.appendChild(el);
    return () => {
        if (next && next.parentNode === parent) parent.insertBefore(el, next);
        else parent.appendChild(el);
    };
}

type ViewBox = {
    cx: number;
    cy: number;
    halfW: number;
    halfH: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
};

function makeViewBox(cx: number, cy: number, halfW: number, halfH: number): ViewBox {
    return {
        cx,
        cy,
        halfW,
        halfH,
        left: cx - halfW,
        right: cx + halfW,
        top: cy - halfH,
        bottom: cy + halfH,
    };
}

function contains(v: ViewBox, p: Pt): boolean {
    return p.x >= v.left && p.x <= v.right && p.y >= v.top && p.y <= v.bottom;
}

function readViewBox(svg: SVGSVGElement): { x: number; y: number; w: number; h: number } | null {
    const attr = svg.getAttribute('viewBox');
    if (!attr) return null;
    const [x, y, w, h] = attr.split(/\s+/).map(Number);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    return { x, y, w, h };
}

function trimToPill(fromPt: Pt, centerPt: Pt, rw: number, rh: number, pad: number): Pt {
    const dx = fromPt.x - centerPt.x;
    const dy = fromPt.y - centerPt.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < 1e-6 && ady < 1e-6) return { x: centerPt.x, y: centerPt.y };
    const tx = adx > 1e-6 ? (rw / 2 + pad) / adx : Infinity;
    const ty = ady > 1e-6 ? (rh / 2 + pad) / ady : Infinity;
    const t = Math.min(tx, ty);
    return { x: centerPt.x + dx * t, y: centerPt.y + dy * t };
}

/** Inset slightly so arrowheads stay on-panel. */
function clipToViewBox(view: ViewBox, startPt: Pt, dir: Pt): Pt {
    let tMax = Infinity;
    if (dir.x > 1e-9) tMax = Math.min(tMax, (view.right - startPt.x) / dir.x);
    else if (dir.x < -1e-9) tMax = Math.min(tMax, (view.left - startPt.x) / dir.x);
    if (dir.y > 1e-9) tMax = Math.min(tMax, (view.bottom - startPt.y) / dir.y);
    else if (dir.y < -1e-9) tMax = Math.min(tMax, (view.top - startPt.y) / dir.y);
    if (!Number.isFinite(tMax) || tMax <= 0) return startPt;
    const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
    const t = Math.max(0, tMax - (HEX_CELL_SIZE * 0.05) / dirLen);
    return { x: startPt.x + dir.x * t, y: startPt.y + dir.y * t };
}

type PillDims = {
    rw: number;
    topRh: number;
    bottomRh: number;
    totalRh: number;
    fontPx: number;
    bottomFontPx: number;
};

/** The extras bottom half counts toward total height so warps trim around the full box; the 3-char triplet sets min width when extras show. */
function computePillDims(
    s: NeighborhoodSector,
    isCurrent: boolean,
    labelSize: number,
    extrasEnabled: boolean,
): PillDims {
    const fontPx = isCurrent ? labelSize * 1.2 : labelSize;
    const cw = fontPx * 0.62;
    const px = fontPx * 0.5;
    const py = fontPx * 0.3;
    const showExtras = extrasEnabled && s.visibility === 'visited';
    const bottomFontPx = fontPx * BOTTOM_HALF_FONT_RATIO;
    const minLabelWidth = String(s.sector_number).length * cw;
    const minTripletWidth = showExtras ? 3 * (bottomFontPx * 0.62) : 0;
    const rw = Math.max(minLabelWidth, minTripletWidth) + px * 2;
    const topRh = fontPx + py * 2;
    const bottomRh = showExtras ? bottomFontPx + py * 1.4 : 0;
    return { rw, topRh, bottomRh, totalRh: topRh + bottomRh, fontPx, bottomFontPx };
}

const ARROW_MARKERS = [
    { id: 'arrDim', cls: 'minimap-arrowhead--dim' },
    { id: 'arrRed', cls: 'minimap-arrowhead--danger' },
    { id: 'arrTwoWay', cls: 'minimap-arrowhead--two-way' },
    { id: 'arrWormhole', cls: 'minimap-arrowhead--wormhole' },
];

function buildArrowDefs(): SVGDefsElement {
    const defs = svgEl('defs');
    for (const m of ARROW_MARKERS) {
        const marker = svgEl('marker', undefined, {
            id: m.id,
            viewBox: '0 0 10 10',
            refX: 9,
            refY: 5,
            markerWidth: 5,
            markerHeight: 5,
            orient: 'auto-start-reverse',
        });
        marker.appendChild(svgEl('path', m.cls, { d: 'M 0 0 L 10 5 L 0 10 z' }));
        defs.appendChild(marker);
    }
    return defs;
}

function drawQuickMoveBadge(
    parent: SVGGElement,
    index: number,
    halfH: number,
    fontPx: number,
    strokeW: number,
): void {
    const r = fontPx * 0.65;
    const cy = halfH + r + fontPx * 0.25;
    parent.appendChild(
        svgEl('circle', 'minimap-quick-move-badge', { cx: 0, cy, r, 'stroke-width': strokeW }),
    );
    parent.appendChild(
        svgText(
            'minimap-quick-move-badge-text',
            { x: 0, y: cy, 'font-size': fontPx * 0.95 },
            String(index),
        ),
    );
}

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
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function readExtrasPreference(): boolean {
    try {
        return localStorage.getItem(EXTRAS_LS_KEY) !== '0';
    } catch {
        return true;
    }
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
    /** centerXWorld/Y are undefined while the viewport follows the current sector. */
    getViewport(): {
        halfWidthWorld: number;
        halfHeightWorld: number;
        centerXWorld?: number;
        centerYWorld?: number;
    };
    onRequestRefresh(handler: () => void): void;
    setQuickMove(targets: number[] | null): void;
    setAdminMode(adminMode: boolean): void;
    openMenu(opts: { title?: string; buttons: MinimapMenuButton[] }): void;
    closeMenu(): void;
}

type MinimapState = {
    zoom: number;
    data: NeighborhoodReply | null;
    currentSectorNumber: number;
    currentSectorId: number;
    quickMoveTargets: number[] | null;
    adminMode: boolean;
    /** null = follow the current sector; set on zoom/pan away, cleared when the player moves. */
    viewportCenter: Pt | null;
    extrasEnabled: boolean;
};

type RenderContext = {
    sectors: NeighborhoodSector[];
    warps: NeighborhoodWarp[];
    byId: Map<number, NeighborhoodSector>;
    current: NeighborhoodSector | undefined;
    currentId: number;
    pillPos: Map<number, Pt>;
    /** Out-of-view fringe targets — direction vectors only, never pills. */
    fringePos: Map<number, Pt>;
    dims: Map<number, PillDims>;
    quickMoveIndexById: Map<number, number>;
    view: ViewBox;
    labelSize: number;
    strokeW: number;
    worldPerPx: number;
    warpGroup: SVGGElement;
    nodeGroup: SVGGElement;
    overlayGroup: SVGGElement;
    warpLines: SVGLineElement[];
    pillRectsBySectorId: Map<number, SVGRectElement>;
    pillGroupBySectorId: Map<number, SVGGElement>;
    /** Keyed by source sector so hovering the near end highlights every off-screen target from it. */
    endLabelsBySrcId: Map<number, SVGGElement[]>;
};

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

    const panel = container.querySelector<HTMLElement>('.minimap-body')!;
    const svg = container.querySelector<SVGSVGElement>('.minimap-svg')!;
    const emptyState = container.querySelector<HTMLElement>('.empty-state')!;
    const infoPanel = container.querySelector<HTMLElement>('.minimap-info-panel')!;
    const header = container.querySelector<HTMLElement>('.minimap-header')!;

    for (const [name, c] of Object.entries(colorPalette)) {
        container.style.setProperty(`--pal-${name}`, rgb(c));
    }

    const arrowDefs = buildArrowDefs();
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

    function computeViewport(): {
        halfWidthWorld: number;
        halfHeightWorld: number;
        centerXWorld?: number;
        centerYWorld?: number;
    } {
        const panelW = panel.clientWidth || 320;
        const panelH = panel.clientHeight || 320;
        const worldWidth = (BASE_CELLS_ACROSS / state.zoom) * HEX_CELL_SIZE;
        const worldHeight = (worldWidth * panelH) / panelW;
        return {
            halfWidthWorld: worldWidth / 2,
            halfHeightWorld: worldHeight / 2,
            centerXWorld: state.viewportCenter?.x,
            centerYWorld: state.viewportCenter?.y,
        };
    }

    function currentSectorWorld(): Pt | null {
        if (!state.data) return null;
        const cur = state.data.sectors.find((s) => s.id === state.data!.current_sector_id);
        if (!cur || cur.x == null || cur.y == null) return null;
        return { x: cur.x, y: cur.y };
    }

    function mouseToWorld(e: MouseEvent): Pt | null {
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const sx = (e.clientX - rect.left) / rect.width;
        const sy = (e.clientY - rect.top) / rect.height;
        if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return null;
        const vb = readViewBox(svg);
        if (!vb) return null;
        return { x: vb.x + sx * vb.w, y: vb.y + sy * vb.h };
    }

    // Alt+wheel zooms toward the cursor: the world point under it stays put.
    container.addEventListener(
        'wheel',
        (e: WheelEvent) => {
            if (!e.altKey) return;
            e.preventDefault();
            e.stopPropagation();
            const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
            if (Math.abs(next - state.zoom) < 1e-4) return;

            const worldUnder = mouseToWorld(e);
            const oldZoom = state.zoom;
            state.zoom = next;
            if (worldUnder) {
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

    // Pan move/up listeners live on the document so drags that leave the panel still track.
    let panState: { lastX: number; lastY: number } | null = null;
    let panRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    function schedulePanRefresh(): void {
        if (panRefreshTimer !== null) return;
        panRefreshTimer = setTimeout(() => {
            panRefreshTimer = null;
            refreshHandler?.();
        }, PAN_REFRESH_MS);
    }
    panel.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 1) return;
        e.preventDefault();
        if (state.viewportCenter === null) {
            const cur = currentSectorWorld();
            if (!cur) return;
            state.viewportCenter = { x: cur.x, y: cur.y };
        }
        panState = { lastX: e.clientX, lastY: e.clientY };
        panel.classList.add('is-panning');
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!panState || !state.viewportCenter) return;
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const vb = readViewBox(svg);
        if (!vb) return;
        const dxPx = e.clientX - panState.lastX;
        const dyPx = e.clientY - panState.lastY;
        panState.lastX = e.clientX;
        panState.lastY = e.clientY;
        // Drag right -> see what's to the left -> camera moves left.
        state.viewportCenter = {
            x: state.viewportCenter.x - (dxPx * vb.w) / rect.width,
            y: state.viewportCenter.y - (dyPx * vb.h) / rect.height,
        };
        render();
        schedulePanRefresh();
    });
    document.addEventListener('mouseup', (e: MouseEvent) => {
        if (!panState || e.button !== 1) return;
        panState = null;
        panel.classList.remove('is-panning');
        if (panRefreshTimer !== null) {
            clearTimeout(panRefreshTimer);
            panRefreshTimer = null;
        }
        refreshHandler?.();
    });

    function setHoveredInfo(sector: NeighborhoodSector): void {
        renderInfoPanel(sector);
        infoPanel.classList.add('is-hovering');
    }

    function clearHoveredInfo(currentSector: NeighborhoodSector | undefined): void {
        renderInfoPanel(currentSector);
        infoPanel.classList.remove('is-hovering');
    }

    function renderInfoPanel(sector: NeighborhoodSector | undefined): void {
        infoPanel.replaceChildren();
        if (!sector) return;

        const bodyEl = document.createElement('div');
        bodyEl.className = 'info-body';

        bodyEl.appendChild(span('Sector', 'info-sector-label'));
        bodyEl.appendChild(span(' : ', 'info-sep'));
        bodyEl.appendChild(span(`${sector.sector_number}\n`, 'info-sector-number'));

        if (sector.visibility !== 'glimpsed') {
            if (sector.port) {
                const triplet = portClassTriplet(sector.port.class);
                bodyEl.appendChild(span('Port', 'info-port-label'));
                bodyEl.appendChild(span(' : ', 'info-sep'));
                bodyEl.appendChild(span(`Class ${sector.port.class} `, 'info-port-class'));
                bodyEl.appendChild(span('(', 'info-parens'));
                if (triplet) {
                    for (const ch of triplet) {
                        if (ch === 'S') bodyEl.appendChild(span('S', 'info-triplet-sell'));
                        else if (ch === 'B') bodyEl.appendChild(span('B', 'info-triplet-buy'));
                    }
                } else {
                    bodyEl.appendChild(span('Special', 'info-port-class'));
                }
                bodyEl.appendChild(span(')', 'info-parens'));
                bodyEl.appendChild(document.createTextNode('\n'));
            }
            if (sector.planets.length > 0) {
                bodyEl.appendChild(span('Planets', 'info-planets-label'));
                bodyEl.appendChild(span(' : ', 'info-sep'));
                bodyEl.appendChild(span(`${sector.planets.length}\n`, 'info-planet-count'));
                for (const p of sector.planets) {
                    bodyEl.appendChild(document.createTextNode('  • '));
                    bodyEl.appendChild(span(p.name, 'info-planet-name'));
                    if (p.type) {
                        bodyEl.appendChild(document.createTextNode(' '));
                        bodyEl.appendChild(span(`(${p.type})`, 'info-planet-type'));
                    }
                    bodyEl.appendChild(document.createTextNode('\n'));
                }
            }
        }
        infoPanel.appendChild(bodyEl);

        const latest = latestObservation(sector);
        if (latest) {
            const footer = document.createElement('div');
            footer.className = 'info-footer';
            footer.appendChild(span('Observed', 'info-observed-label'));
            footer.appendChild(span(' : ', 'info-sep'));
            footer.appendChild(span(formatObserved(latest), 'info-observed-value'));
            infoPanel.appendChild(footer);
        }
    }

    function showEmpty(message: string): void {
        emptyState.classList.remove('is-hidden');
        emptyState.textContent = message;
    }

    function resolveCenter(sectors: NeighborhoodSector[], current?: NeighborhoodSector): Pt | null {
        if (state.viewportCenter) return state.viewportCenter;
        if (current && current.x != null && current.y != null) {
            return { x: current.x, y: current.y };
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            minX = Math.min(minX, s.x);
            maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y);
            maxY = Math.max(maxY, s.y);
        }
        if (!Number.isFinite(minX)) return null;
        return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }

    function buildQuickMoveIndex(sectors: NeighborhoodSector[]): Map<number, number> {
        const byIndex = new Map<number, number>();
        if (!state.quickMoveTargets || state.quickMoveTargets.length === 0) return byIndex;
        const numberToId = new Map<number, number>();
        for (const s of sectors) numberToId.set(s.sector_number, s.id);
        state.quickMoveTargets.forEach((secNum, i) => {
            const id = numberToId.get(secNum);
            if (id !== undefined) byIndex.set(id, i + 1);
        });
        return byIndex;
    }

    function render(): void {
        svg.replaceChildren();
        if (state.data && state.data.topology === 'random') {
            container.classList.add('is-hidden');
            return;
        }
        container.classList.remove('is-hidden');
        if (!state.data) {
            showEmpty('Loading map…');
            clearHoveredInfo(undefined);
            return;
        }
        if (state.data.sectors.length === 0) {
            showEmpty('No visited sectors yet — move to populate the map.');
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

        const viewport = computeViewport();
        const center = resolveCenter(sectors, current);
        if (!center) {
            showEmpty('No positioned sectors in view.');
            return;
        }
        const view = makeViewBox(
            center.x,
            center.y,
            viewport.halfWidthWorld,
            viewport.halfHeightWorld,
        );

        const pillPos = new Map<number, Pt>();
        const fringePos = new Map<number, Pt>();
        for (const s of sectors) {
            if (s.x == null || s.y == null) continue;
            const p = { x: s.x, y: s.y };
            if (s.fringe && !contains(view, p)) fringePos.set(s.id, p);
            else pillPos.set(s.id, p);
        }

        svg.setAttribute('viewBox', `${view.left} ${view.top} ${view.halfW * 2} ${view.halfH * 2}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.appendChild(arrowDefs);

        const labelSize = HEX_CELL_SIZE * LABEL_FRACTION_OF_CELL;

        const dims = new Map<number, PillDims>();
        for (const s of sectors) {
            if (!pillPos.has(s.id)) continue;
            dims.set(s.id, computePillDims(s, s.id === currentId, labelSize, state.extrasEnabled));
        }

        const warpGroup = svgEl('g');
        const nodeGroup = svgEl('g');
        const overlayGroup = svgEl('g');
        svg.appendChild(warpGroup);

        const rc: RenderContext = {
            sectors,
            warps: state.data.warps,
            byId,
            current,
            currentId,
            pillPos,
            fringePos,
            dims,
            quickMoveIndexById: buildQuickMoveIndex(sectors),
            view,
            labelSize,
            strokeW: HEX_CELL_SIZE * 0.04,
            // The viewBox matches the panel's aspect ratio, so `meet` scales uniformly by panelWidth / viewBoxWidth.
            worldPerPx: (view.halfW * 2) / (panel.clientWidth || 320),
            warpGroup,
            nodeGroup,
            overlayGroup,
            warpLines: [],
            pillRectsBySectorId: new Map(),
            pillGroupBySectorId: new Map(),
            endLabelsBySrcId: new Map(),
        };

        renderWarps(rc);

        svg.appendChild(nodeGroup);
        svg.appendChild(overlayGroup);

        renderPills(rc);
    }

    function renderWarps(rc: RenderContext): void {
        const { view, strokeW } = rc;
        const drawnBi = new Set<string>();

        for (const w of rc.warps) {
            const src = rc.byId.get(w.from_sector_id);
            const dst = rc.byId.get(w.to_sector_id);
            if (!src || !dst) continue;
            const srcP = rc.pillPos.get(w.from_sector_id);
            const dstP = rc.pillPos.get(w.to_sector_id) ?? rc.fringePos.get(w.to_sector_id);
            if (!srcP || !dstP) continue;
            const srcPill = rc.dims.get(w.from_sector_id);
            if (!srcPill) continue;
            // An off-screen source would draw a ghost line across the panel — very visible mid-pan.
            if (!contains(view, srcP)) continue;

            const dstPill = rc.dims.get(w.to_sector_id);
            const srcVisited = src.visibility === 'visited';
            const dstVisited = dst.visibility === 'visited';
            const dstOnscreen = contains(view, dstP);
            const dxFull = dstP.x - srcP.x;
            const dyFull = dstP.y - srcP.y;

            // Wormhole-ness is edge geometry, not target visibility — it wins over glimpsed-target styling.
            const isWormhole = srcVisited && dxFull * dxFull + dyFull * dyFull > WORMHOLE_DIST_SQ;
            const isTwoWay = srcVisited && dstVisited && w.known_two_way;
            if (isTwoWay) {
                const key = `${Math.min(w.from_sector_id, w.to_sector_id)}-${Math.max(w.from_sector_id, w.to_sector_id)}`;
                if (drawnBi.has(key)) continue;
                drawnBi.add(key);
            }

            const start = trimToPill(dstP, srcP, srcPill.rw, srcPill.totalRh, strokeW * 0.5);
            let end: Pt;
            if (!dstOnscreen) {
                end = clipToViewBox(view, start, { x: dxFull, y: dyFull });
            } else if (dstPill) {
                const pad = isTwoWay ? strokeW * 0.5 : strokeW * 3;
                end = trimToPill(srcP, dstP, dstPill.rw, dstPill.totalRh, pad);
            } else {
                continue;
            }

            // TODO: the right-of-travel nudge separates opposite one-ways visually; unclear whether still needed.
            if (!isTwoWay) {
                const len = Math.sqrt(dxFull * dxFull + dyFull * dyFull);
                if (len > 1e-6) {
                    const off = 3 * rc.worldPerPx;
                    // Right-perpendicular in SVG's y-down coords: (-uy, ux).
                    const offX = (-dyFull / len) * off;
                    const offY = (dxFull / len) * off;
                    start.x += offX;
                    start.y += offY;
                    end.x += offX;
                    end.y += offY;
                }
            }

            const coords = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };

            // At crossings a later halo punches a gap through earlier warps, reading as one segment tunnelling under another.
            if (isTwoWay) {
                rc.warpGroup.appendChild(
                    svgEl('line', 'minimap-warp-halo', {
                        ...coords,
                        'stroke-width': strokeW * 2.4,
                    }),
                );
            }

            const isQuickMoveWarp =
                (w.from_sector_id === rc.currentId && rc.quickMoveIndexById.has(w.to_sector_id)) ||
                (w.to_sector_id === rc.currentId && rc.quickMoveIndexById.has(w.from_sector_id));

            const line = svgEl(
                'line',
                ['minimap-warp', isQuickMoveWarp && 'minimap-warp--quick-move'],
                { ...coords, 'stroke-width': strokeW },
            );
            line.dataset.fromId = String(w.from_sector_id);
            line.dataset.toId = String(w.to_sector_id);
            if (isTwoWay) line.dataset.twoWay = 'true';
            styleWarpLine(line, {
                strokeW,
                isWormhole,
                isTwoWay,
                dstOnscreen,
                isFringe: dst.fringe === true,
                explored: srcVisited && dstVisited,
            });
            rc.warpLines.push(line);
            rc.warpGroup.appendChild(line);

            // A regular warp's far end sits just past the edge and its node would cover the on-screen counterpart.
            if (!dstOnscreen && isWormhole) {
                const node = buildOffscreenNode(rc, {
                    dst,
                    dstVisited,
                    start,
                    end,
                    quickMoveIndex: isQuickMoveWarp
                        ? rc.quickMoveIndexById.get(w.to_sector_id)
                        : undefined,
                    line,
                    srcId: w.from_sector_id,
                });
                rc.overlayGroup.appendChild(node);
                const list = rc.endLabelsBySrcId.get(w.from_sector_id);
                if (list) list.push(node);
                else rc.endLabelsBySrcId.set(w.from_sector_id, [node]);
            }
        }
    }

    function styleWarpLine(
        line: SVGLineElement,
        o: {
            strokeW: number;
            isWormhole: boolean;
            isTwoWay: boolean;
            dstOnscreen: boolean;
            isFringe: boolean;
            explored: boolean;
        },
    ): void {
        const dash = `${o.strokeW * 2} ${o.strokeW * 2}`;
        if (o.isWormhole) {
            if (!o.dstOnscreen) {
                line.classList.add('minimap-warp--wormhole-stub');
                line.setAttribute('stroke-dasharray', dash);
                line.setAttribute('marker-end', 'url(#arrWormhole)');
            } else {
                line.classList.add('minimap-warp--wormhole');
                if (!o.isTwoWay) line.setAttribute('marker-end', 'url(#arrWormhole)');
            }
        } else if (!o.explored) {
            line.classList.add('minimap-warp--unexplored');
            line.setAttribute('stroke-dasharray', dash);
            line.setAttribute('marker-end', 'url(#arrDim)');
        } else if (o.isTwoWay) {
            line.classList.add('minimap-warp--two-way');
            if (o.isFringe || !o.dstOnscreen) line.setAttribute('marker-end', 'url(#arrTwoWay)');
        } else {
            line.classList.add('minimap-warp--one-way-confirmed');
            line.setAttribute('marker-end', 'url(#arrRed)');
            if (!o.dstOnscreen) line.setAttribute('stroke-dasharray', dash);
        }
    }

    function buildOffscreenNode(
        rc: RenderContext,
        o: {
            dst: NeighborhoodSector;
            dstVisited: boolean;
            start: Pt;
            end: Pt;
            quickMoveIndex: number | undefined;
            line: SVGLineElement;
            srcId: number;
        },
    ): SVGGElement {
        const { dst, dstVisited, start, end, quickMoveIndex, line, srcId } = o;
        const ldx = end.x - start.x;
        const ldy = end.y - start.y;
        const llen = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        const inset = HEX_CELL_SIZE * 0.6;
        const x = end.x - (ldx / llen) * inset;
        const y = end.y - (ldy / llen) * inset;

        const group = svgEl(
            'g',
            [
                'minimap-warp-end-label',
                dstVisited ? 'minimap-warp-end-label--visited' : 'minimap-warp-end-label--glimpsed',
            ],
            { transform: `translate(${x}, ${y})` },
        );

        const dstNum = String(dst.sector_number);
        const fontPx = rc.labelSize * 0.95;
        const rw = dstNum.length * (fontPx * 0.62) + fontPx * 0.45 * 2;
        const rh = fontPx + fontPx * 0.28 * 2;
        const rx = fontPx * 0.3;

        group.appendChild(
            svgEl('rect', undefined, {
                x: -rw / 2,
                y: -rh / 2,
                width: rw,
                height: rh,
                rx,
                ry: rx,
                'stroke-width': rc.strokeW,
            }),
        );
        group.appendChild(svgText('minimap-warp-end-label-text', { 'font-size': fontPx }, dstNum));
        if (quickMoveIndex !== undefined) {
            drawQuickMoveBadge(group, quickMoveIndex, rh / 2, fontPx, rc.strokeW);
        }

        // The hovered node is never raised — re-appending the element under the cursor fires spurious leave/enter events.
        const raiseRestores: Array<() => void> = [];
        group.addEventListener('mouseenter', () => {
            setHoveredInfo(dst);
            group.classList.add('is-highlighted');
            line.classList.add('minimap-warp--hover-out');
            rc.pillRectsBySectorId.get(srcId)?.classList.add('minimap-sector-pill--hover-source');
            const srcGroup = rc.pillGroupBySectorId.get(srcId);
            if (srcGroup) raiseRestores.push(raiseToFront(srcGroup));
        });
        group.addEventListener('mouseleave', () => {
            clearHoveredInfo(rc.current);
            group.classList.remove('is-highlighted');
            line.classList.remove('minimap-warp--hover-out');
            rc.pillRectsBySectorId
                .get(srcId)
                ?.classList.remove('minimap-sector-pill--hover-source');
            while (raiseRestores.length) raiseRestores.pop()!();
        });
        group.addEventListener('click', () => {
            onInject(dst.sector_number, rc.current?.sector_number ?? state.currentSectorNumber);
        });

        return group;
    }

    function renderPills(rc: RenderContext): void {
        const { strokeW } = rc;

        const adjacent = new Set<number>();
        for (const w of rc.warps) {
            if (w.from_sector_id === rc.currentId) adjacent.add(w.to_sector_id);
        }
        const priority = (s: NeighborhoodSector): number =>
            s.id === rc.currentId ? 2 : adjacent.has(s.id) ? 1 : 0;
        const drawOrder = [...rc.sectors].sort((a, b) => priority(a) - priority(b));

        for (const s of drawOrder) {
            const p = rc.pillPos.get(s.id);
            const d = rc.dims.get(s.id);
            if (!p || !d) continue;
            const isCurrent = s.id === rc.currentId;
            const visited = s.visibility === 'visited';
            const quickMoveIndex = rc.quickMoveIndexById.get(s.id);

            const group = svgEl('g', 'sector-node', { transform: `translate(${p.x}, ${p.y})` });

            const rx = d.fontPx * 0.35;
            const rect = svgEl(
                'rect',
                [
                    isCurrent
                        ? 'minimap-sector-pill--current'
                        : visited
                          ? 'minimap-sector-pill--visited'
                          : 'minimap-sector-pill--glimpsed',
                    quickMoveIndex !== undefined && 'minimap-sector-pill--quick-move',
                ],
                {
                    x: -d.rw / 2,
                    y: -d.totalRh / 2,
                    width: d.rw,
                    height: d.totalRh,
                    rx,
                    ry: rx,
                },
            );
            if (isCurrent || visited) {
                rect.setAttribute('stroke-width', String(strokeW));
            } else {
                rect.setAttribute('stroke-width', String(strokeW * 0.8));
                rect.setAttribute('stroke-dasharray', `${strokeW} ${strokeW}`);
            }
            // Overrides the visibility stroke-width but not the dashes — a glimpsed quick-move target keeps them.
            if (quickMoveIndex !== undefined) {
                rect.setAttribute('stroke-width', String(strokeW * 1.8));
            }
            rc.pillRectsBySectorId.set(s.id, rect);
            rc.pillGroupBySectorId.set(s.id, group);
            group.appendChild(rect);

            if (d.bottomRh > 0) drawPortBand(group, s, d, strokeW);

            group.appendChild(
                svgText(
                    [
                        'minimap-sector-label',
                        isCurrent
                            ? 'minimap-sector-label--current'
                            : visited
                              ? 'minimap-sector-label--visited'
                              : 'minimap-sector-label--glimpsed',
                    ],
                    { 'font-size': d.fontPx, y: -d.bottomRh / 2 },
                    String(s.sector_number),
                ),
            );

            if (state.extrasEnabled && visited) {
                if (s.planets.length > 0) {
                    group.appendChild(
                        svgText(
                            'minimap-planet-glyph',
                            {
                                'text-anchor': 'start',
                                'dominant-baseline': 'auto',
                                x: d.rw / 2 - d.fontPx * 0.15,
                                y: -d.totalRh / 2 - d.fontPx * 0.15,
                                'font-size': d.fontPx * 0.9,
                            },
                            '◉',
                        ),
                    );
                }
                if (s.observations) drawObservationIcons(group, s.observations, d);
            }

            if (quickMoveIndex !== undefined) {
                drawQuickMoveBadge(group, quickMoveIndex, d.totalRh / 2, d.fontPx, strokeW);
            }

            attachPillHover(rc, s, group, rect);
            rc.nodeGroup.appendChild(group);
        }
    }

    function drawPortBand(
        group: SVGGElement,
        s: NeighborhoodSector,
        d: PillDims,
        strokeW: number,
    ): void {
        group.appendChild(
            svgEl('line', 'minimap-sector-pill-divider', {
                x1: -d.rw / 2,
                x2: d.rw / 2,
                y1: (d.topRh - d.bottomRh) / 2,
                y2: (d.topRh - d.bottomRh) / 2,
                'stroke-width': strokeW,
            }),
        );
        if (!s.port) return;

        const y = d.topRh / 2;
        const triplet = portClassTriplet(s.port.class);
        if (!triplet) {
            group.appendChild(
                svgText(
                    'minimap-port-triplet',
                    { x: 0, y, 'font-size': d.bottomFontPx },
                    `C${s.port.class}`,
                ),
            );
            return;
        }
        const cw = d.bottomFontPx * 0.62;
        for (let i = 0; i < triplet.length; i++) {
            const ch = triplet[i];
            group.appendChild(
                svgText(
                    [
                        'minimap-port-triplet',
                        ch === 'S' && 'minimap-port-triplet--sell',
                        ch === 'B' && 'minimap-port-triplet--buy',
                    ],
                    {
                        x: cw * (i - (triplet.length - 1) / 2),
                        y,
                        'font-size': d.bottomFontPx,
                    },
                    ch,
                ),
            );
        }
    }

    /** Corners the pill isn't already using (planets own top-right, badges hang below): drones top-left, prox mines bottom-left, seeker mines bottom-right. */
    function drawObservationIcons(
        group: SVGGElement,
        obs: NonNullable<NeighborhoodSector['observations']>,
        d: PillDims,
    ): void {
        const fontPx = d.fontPx * 0.7;
        const offset = d.fontPx * 0.15;
        const leftX = -d.rw / 2 + fontPx * 0.5;
        const icon = (friendly: boolean, attrs: Attrs, glyph: string): void => {
            group.appendChild(
                svgText(
                    [
                        'minimap-obs-icon',
                        friendly ? 'minimap-obs-icon--friendly' : 'minimap-obs-icon--enemy',
                    ],
                    { 'font-size': fontPx, ...attrs },
                    glyph,
                ),
            );
        };

        if (obs.friendlyDrones || obs.enemyDrones) {
            icon(
                !!obs.friendlyDrones,
                {
                    'text-anchor': 'end',
                    'dominant-baseline': 'alphabetic',
                    x: leftX,
                    y: -d.totalRh / 2 - offset,
                },
                '▲',
            );
        }
        if (obs.friendlyProxMines || obs.enemyProxMines) {
            icon(
                !!obs.friendlyProxMines,
                {
                    'text-anchor': 'end',
                    'dominant-baseline': 'hanging',
                    x: leftX,
                    y: d.totalRh / 2 + offset * 0.2,
                },
                '✱',
            );
        }
        if (obs.friendlySeekerMines) {
            icon(
                true,
                {
                    'text-anchor': 'start',
                    'dominant-baseline': 'hanging',
                    x: d.rw / 2 - fontPx * 0.5,
                    y: d.totalRh / 2 + offset * 0.2,
                },
                'L',
            );
        }
    }

    function attachPillHover(
        rc: RenderContext,
        s: NeighborhoodSector,
        group: SVGGElement,
        rect: SVGRectElement,
    ): void {
        const raiseRestores: Array<() => void> = [];

        const apply = (): void => {
            rect.classList.add('minimap-sector-pill--hover-source');
            for (const line of rc.warpLines) {
                const fromId = Number(line.dataset.fromId);
                const toId = Number(line.dataset.toId);
                const twoWay = line.dataset.twoWay === 'true';
                let otherId: number | null = null;
                if (fromId === s.id) otherId = toId;
                else if (twoWay && toId === s.id) otherId = fromId;
                if (otherId === null) continue;
                line.classList.add('minimap-warp--hover-out');
                rc.pillRectsBySectorId
                    .get(otherId)
                    ?.classList.add('minimap-sector-pill--hover-target');
                const targetGroup = rc.pillGroupBySectorId.get(otherId);
                if (targetGroup) raiseRestores.push(raiseToFront(targetGroup));
            }
            for (const l of rc.endLabelsBySrcId.get(s.id) ?? []) {
                l.classList.add('is-highlighted');
                raiseRestores.push(raiseToFront(l));
            }
        };

        const clear = (): void => {
            rect.classList.remove('minimap-sector-pill--hover-source');
            for (const line of rc.warpLines) line.classList.remove('minimap-warp--hover-out');
            for (const r of rc.pillRectsBySectorId.values()) {
                r.classList.remove('minimap-sector-pill--hover-target');
            }
            for (const l of rc.endLabelsBySrcId.get(s.id) ?? []) {
                l.classList.remove('is-highlighted');
            }
            while (raiseRestores.length) raiseRestores.pop()!();
        };

        group.addEventListener('mouseenter', () => {
            setHoveredInfo(s);
            apply();
        });
        group.addEventListener('mouseleave', () => {
            clearHoveredInfo(rc.current);
            clear();
        });
        group.addEventListener('click', () => {
            onInject(s.sector_number, rc.current?.sector_number ?? state.currentSectorNumber);
        });
    }

    let menuEl: HTMLElement | null = null;
    let lastMouseX: number | null = null;
    let lastMouseY: number | null = null;

    container.addEventListener('mousemove', (e: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        lastMouseX = e.clientX - rect.left;
        lastMouseY = e.clientY - rect.top;
    });
    container.addEventListener('mousedown', (e: MouseEvent) => {
        if (menuEl && !menuEl.contains(e.target as Node)) destroyMenu();
    });

    function destroyMenu(): void {
        menuEl?.remove();
        menuEl = null;
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

    function positionMountedMenu(el: HTMLElement): void {
        const rect = container.getBoundingClientRect();
        const margin = 4;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const anchorX = lastMouseX ?? rect.width / 2;
        const anchorY = lastMouseY ?? rect.height / 2;
        let x = anchorX + 2;
        let y = anchorY + 2;
        if (x + w + margin > rect.width) x = Math.max(margin, anchorX - w - 2);
        if (y + h + margin > rect.height) y = Math.max(margin, anchorY - h - 2);
        el.style.left = `${Math.max(margin, Math.min(rect.width - w - margin, x))}px`;
        el.style.top = `${Math.max(margin, Math.min(rect.height - h - margin, y))}px`;
    }

    return {
        update(data, currentSectorNumber) {
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
            state.quickMoveTargets = hasTargets ? [...targets!] : null;
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
            positionMountedMenu(menuEl);
        },
        closeMenu() {
            destroyMenu();
        },
    };
}
