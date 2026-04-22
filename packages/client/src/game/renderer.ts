import { colorPalette, type ColorConfig, type ColorPalette } from '../config/colors.js';

const TAG_TO_COLOR: Record<string, ColorConfig> = {
    k: colorPalette.black,
    mg: colorPalette.magenta,
    bg: colorPalette.boldGreen,
    by: colorPalette.boldYellow,
    bc: colorPalette.boldCyan,
    br: colorPalette.boldRed,
    bw: colorPalette.boldWhite,
    w: colorPalette.white,
    c: colorPalette.cyan,
    g: colorPalette.green,
    r: colorPalette.red,
    b: colorPalette.blue,
    y: colorPalette.yellow,
    bb: colorPalette.boldBlue,
    bm: colorPalette.boldMagenta,
};

const RESET = '\x1b[0m';
// Tag names: letters and digits, optionally `fg:bg` (either side may be empty for bg-only: `:bb`)
const TAG_RE = /\[(\/?[A-Za-z0-9]*(?::[A-Za-z0-9]+)?)\]/g;
const INCLUDE_RE = /\{\{([\w.]+)\}\}/g;
const MAX_INCLUDE_DEPTH = 10;

const REGISTRY: Record<string, string> = {};

interface Frame {
    fg?: ColorConfig;
    bg?: ColorConfig;
}

function fgCode({ r, g, b }: ColorConfig): string {
    return `\x1b[38;2;${r};${g};${b}m`;
}
function bgCode({ r, g, b }: ColorConfig): string {
    return `\x1b[48;2;${r};${g};${b}m`;
}
function frameCode(frame: Frame): string {
    let code = '';
    if (frame.fg) code += fgCode(frame.fg);
    if (frame.bg) code += bgCode(frame.bg);
    return code;
}
/** Compute the cumulative frame (fg/bg) from a stack — more recently pushed
 *  entries override earlier ones for either attribute. */
function effectiveFrame(stack: Frame[]): Frame {
    const out: Frame = {};
    for (const f of stack) {
        if (f.fg) out.fg = f.fg;
        if (f.bg) out.bg = f.bg;
    }
    return out;
}

function parseTag(name: string): Frame | null {
    const colonIdx = name.indexOf(':');
    let fgName = '';
    let bgName = '';
    if (colonIdx === -1) {
        fgName = name;
    } else {
        fgName = name.slice(0, colonIdx);
        bgName = name.slice(colonIdx + 1);
    }
    const frame: Frame = {};
    if (fgName) {
        const fg = TAG_TO_COLOR[fgName];
        if (!fg) return null;
        frame.fg = fg;
    }
    if (bgName) {
        const bg = TAG_TO_COLOR[bgName];
        if (!bg) return null;
        frame.bg = bg;
    }
    return frame.fg || frame.bg ? frame : null;
}

export function registerTemplates(templates: Record<string, string>): void {
    for (const [fullKey, tpl] of Object.entries(templates)) {
        REGISTRY[fullKey] = tpl;
        const dotIdx = fullKey.indexOf('.');
        if (dotIdx > 0) {
            const bareKey = fullKey.slice(dotIdx + 1);
            if (!(bareKey in REGISTRY)) REGISTRY[bareKey] = tpl;
        }
    }
}

export function clearRegistry(): void {
    for (const key of Object.keys(REGISTRY)) delete REGISTRY[key];
}

export function getTemplate(key: string): string | undefined {
    return REGISTRY[key];
}

function expandIncludes(template: string): string {
    let result = template;
    for (let i = 0; i < MAX_INCLUDE_DEPTH; i++) {
        if (!result.includes('{{')) break;
        const next = result.replace(INCLUDE_RE, (m, ref) => REGISTRY[ref] ?? m);
        if (next === result) break;
        result = next;
    }
    return result;
}

export function render(template: string, vars: Record<string, unknown> = {}): string {
    const expanded = expandIncludes(template);
    const interpolated = expanded.replace(/\{(\w+)\}/g, (_, k) =>
        k in vars ? String(vars[k] ?? '') : `{${k}}`,
    );
    const parts = interpolated.split(TAG_RE);
    const stack: Array<{ name: string; frame: Frame }> = [];
    let out = '';
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            out += parts[i];
            continue;
        }
        const tag = parts[i];
        if (tag.startsWith('/')) {
            const name = tag.slice(1);
            const idx = stack.map((s) => s.name).lastIndexOf(name);
            if (idx === -1) continue;
            stack.splice(idx, 1);
            out += RESET;
            out += frameCode(effectiveFrame(stack.map((s) => s.frame)));
        } else {
            const frame = parseTag(tag);
            if (!frame) continue;
            stack.push({ name: tag, frame });
            out += frameCode(frame);
        }
    }
    return out;
}

export function listTags(): string[] {
    return Object.keys(TAG_TO_COLOR);
}

export { colorPalette };
export type { ColorPalette };
