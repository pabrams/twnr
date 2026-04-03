export interface ColorConfig {
    r: number;
    g: number;
    b: number;
}

export interface ColorPalette {
    red: ColorConfig;
    green: ColorConfig;
    blue: ColorConfig;
    cyan: ColorConfig;
    magenta: ColorConfig;
    yellow: ColorConfig;
    white: ColorConfig;
    boldRed: ColorConfig;
    boldGreen: ColorConfig;
    boldBlue: ColorConfig;
    boldCyan: ColorConfig;
    boldMagenta: ColorConfig;
    boldYellow: ColorConfig;
    boldWhite: ColorConfig;
}

// Non-bold colors use 153 (0x99), bold colors use 255 (0xFF)
export const colorPalette: ColorPalette = {
    red: { r: 153, g: 0, b: 0 },
    green: { r: 0, g: 153, b: 0 },
    blue: { r: 0, g: 0, b: 153 },
    cyan: { r: 0, g: 153, b: 153 },
    magenta: { r: 153, g: 0, b: 153 },
    yellow: { r: 153, g: 153, b: 0 },
    white: { r: 192, g: 192, b: 192 },
    boldRed: { r: 255, g: 0, b: 0 },
    boldGreen: { r: 0, g: 255, b: 0 },
    boldBlue: { r: 0, g: 0, b: 255 },
    boldCyan: { r: 0, g: 255, b: 255 },
    boldMagenta: { r: 255, g: 0, b: 255 },
    boldYellow: { r: 255, g: 255, b: 0 },
    boldWhite: { r: 255, g: 255, b: 255 },
};

export type ColorFn = (s: string) => string;
export type Colors = Record<keyof ColorPalette, ColorFn>;

export function buildColors(palette: ColorPalette): Colors {
    const result = {} as Colors;
    for (const [name, { r, g, b }] of Object.entries(palette)) {
        result[name as keyof ColorPalette] = (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
    }
    return result;
}
