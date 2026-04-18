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

function openCode({ r, g, b }: ColorConfig): string {
    return `\x1b[38;2;${r};${g};${b}m`;
}

export function render(template: string, vars: Record<string, unknown> = {}): string {
    const interpolated = template.replace(/\{(\w+)\}/g, (_, k) =>
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
