import { colorPalette, type ColorConfig, type ColorPalette } from '../config/colors.js';

const TAG_TO_COLOR: Record<string, ColorConfig> = {
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
const TAG_RE = /\[(\/?[A-Za-z]+)\]/g;
const INCLUDE_RE = /\{\{([\w.]+)\}\}/g;
const MAX_INCLUDE_DEPTH = 10;

const REGISTRY: Record<string, string> = {};

function openCode({ r, g, b }: ColorConfig): string {
    return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Register templates for `{{ref}}` expansion. Each entry's key may be
 * either a bare name (`playerInfoName`) or a qualified name
 * (`SECTOR.playerInfoName`). Both forms are auto-registered so templates
 * can reference siblings either way. On bare-key collisions, first wins.
 */
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

/** Wipe the entire registry — used by HMR so re-registration produces a
 *  clean state with correct bare-key priority. */
export function clearRegistry(): void {
    for (const key of Object.keys(REGISTRY)) delete REGISTRY[key];
}

/** Look up a template by full key (`DOMAIN.key`) or bare key. Returns the
 *  current live value so callers that read through a domain proxy always
 *  see HMR updates. */
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
    const stack: string[] = [];
    let out = '';
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            out += parts[i];
            continue;
        }
        const tag = parts[i];
        if (tag.startsWith('/')) {
            const name = tag.slice(1);
            const idx = stack.lastIndexOf(name);
            if (idx === -1) continue;
            stack.splice(idx, 1);
            out += RESET;
            const parent = stack[stack.length - 1];
            if (parent && TAG_TO_COLOR[parent]) out += openCode(TAG_TO_COLOR[parent]);
        } else {
            if (!TAG_TO_COLOR[tag]) continue;
            stack.push(tag);
            out += openCode(TAG_TO_COLOR[tag]);
        }
    }
    return out;
}

export function listTags(): string[] {
    return Object.keys(TAG_TO_COLOR);
}

export { colorPalette };
export type { ColorPalette };
