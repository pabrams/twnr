/**
 * Shared display helpers for the client. The renderer turns `[tag]text[/tag]`
 * spans into ANSI escapes, so any padding/alignment has to measure the
 * VISIBLE length of a string — raw `.length` counts the tag markup that will
 * eventually be stripped. These helpers wrap the color-tag regex once so
 * callers can pad colored values and keep columns aligned on screen.
 */

const TAG_RE = /\[\/?[a-zA-Z:0-9]+\]/g;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function visibleLength(s: string): number {
    return s.replace(TAG_RE, '').replace(ANSI_RE, '').length;
}

export function padEndVisible(s: string, width: number): string {
    const n = visibleLength(s);
    return n >= width ? s : s + ' '.repeat(width - n);
}

export function padStartVisible(s: string, width: number): string {
    const n = visibleLength(s);
    return n >= width ? s : ' '.repeat(width - n) + s;
}

export function centerVisible(s: string, width: number): string {
    const n = visibleLength(s);
    if (n >= width) return s;
    const left = Math.floor((width - n) / 2);
    return ' '.repeat(left) + s;
}

export function threeColRows(
    items: Array<{ label: string; value: string }>,
    opts: {
        labelWidth?: number;
        valueWidth?: number;
        gap?: number;
        separator?: string;
        labelColor?: string;
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
