/**
 * Shared display helpers for the client. The renderer turns `[tag]text[/tag]`
 * spans into ANSI escapes, so any padding/alignment has to measure the
 * VISIBLE length of a string — raw `.length` counts the tag markup that will
 * eventually be stripped. These helpers wrap the color-tag regex once so
 * callers can pad colored values and keep columns aligned on screen.
 */

const TAG_RE = /\[\/?[a-zA-Z:0-9]+\]/g;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Visible on-screen length of a string. Strips both unrendered `[tag]` markup
 * and actual ANSI SGR escapes, so strings partway through the render pipeline
 * measure the same as fully-rendered ones.
 */
export function visibleLength(s: string): number {
    return s.replace(TAG_RE, '').replace(ANSI_RE, '').length;
}

/** padEnd counting visible characters. */
export function padEndVisible(s: string, width: number): string {
    const n = visibleLength(s);
    return n >= width ? s : s + ' '.repeat(width - n);
}

/** padStart counting visible characters. */
export function padStartVisible(s: string, width: number): string {
    const n = visibleLength(s);
    return n >= width ? s : ' '.repeat(width - n) + s;
}

/** Center a string within `width` columns, counting visible characters. */
export function centerVisible(s: string, width: number): string {
    const n = visibleLength(s);
    if (n >= width) return s;
    const left = Math.floor((width - n) / 2);
    return ' '.repeat(left) + s;
}

/**
 * Render a flat list of `{label, value}` pairs as a three-column grid with
 * right-justified labels. Labels and values may contain color tags; widths
 * are measured against visible characters so the columns still align on
 * screen. Returns one string per row.
 */
export function threeColRows(
    items: Array<{ label: string; value: string }>,
    opts: {
        labelWidth?: number;
        valueWidth?: number;
        gap?: number;
        /** Separator between label and value — may include `[tag]` markup. Default `': '`. */
        separator?: string;
        /** Optional tag name wrapping every label (e.g. `'g'` → `[g]label[/g]`). */
        labelColor?: string;
        /** Optional tag name wrapping every value. Any inner `[tag]`s in the value (e.g. boolean Yes/No) still apply thanks to the stack-based renderer. */
        valueColor?: string;
    } = {},
): string[] {
    const labelWidth = opts.labelWidth ?? 17;
    const valueWidth = opts.valueWidth ?? 7;
    const gap = opts.gap ?? 1;
    const separator = opts.separator ?? ': ';
    const wrap = (s: string, tag: string | undefined): string =>
        tag ? `[${tag}]${s}[/${tag}]` : s;
    const rows: string[] = [];
    for (let i = 0; i < items.length; i += 3) {
        const parts: string[] = [];
        for (let j = 0; j < 3; j++) {
            const item = items[i + j];
            if (!item) break;
            const label = wrap(padStartVisible(item.label, labelWidth), opts.labelColor);
            const value = wrap(padStartVisible(item.value, valueWidth), opts.valueColor);
            parts.push(`${label}${separator}${value}`);
        }
        rows.push(parts.join(' '.repeat(gap)));
    }
    return rows;
}
