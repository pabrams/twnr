// Bold colors use FF, non-bold use 99
export const colors = {
    red: (s: string) => `\x1b[38;2;153;0;0m${s}\x1b[0m`,
    green: (s: string) => `\x1b[38;2;0;153;0m${s}\x1b[0m`,
    blue: (s: string) => `\x1b[38;2;0;0;153m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[38;2;0;153;153m${s}\x1b[0m`,
    magenta: (s: string) => `\x1b[38;2;153;0;153m${s}\x1b[0m`,
    yellow: (s: string) => `\x1b[38;2;153;153;0m${s}\x1b[0m`,
    boldRed: (s: string) => `\x1b[38;2;255;0;0m${s}\x1b[0m`,
    boldGreen: (s: string) => `\x1b[38;2;0;255;0m${s}\x1b[0m`,
    boldBlue: (s: string) => `\x1b[38;2;0;0;255m${s}\x1b[0m`,
    boldCyan: (s: string) => `\x1b[38;2;0;255;255m${s}\x1b[0m`,
    boldMagenta: (s: string) => `\x1b[38;2;255;0;255m${s}\x1b[0m`,
    boldYellow: (s: string) => `\x1b[38;2;255;255;0m${s}\x1b[0m`,
    white: (s: string) => `\x1b[38;2;192;192;192m${s}\x1b[0m`,
    boldWhite: (s: string) => `\x1b[38;2;255;255;255m${s}\x1b[0m`,
};

export const PORT_CLASS_LABELS: Record<number, string> = {
    0: 'Special',
    1: 'BBS',
    2: 'BSB',
    3: 'SBB',
    4: 'SSB',
    5: 'BSS',
    6: 'SBS',
    7: 'SSS',
    8: 'BBB',
    9: 'Special',
};

export const PORT_CLASS_ACTIONS: Record<number, Record<string, 'B' | 'S'>> = {
    1: { fuel: 'B', organics: 'B', equipment: 'S' },
    2: { fuel: 'B', organics: 'S', equipment: 'B' },
    3: { fuel: 'S', organics: 'B', equipment: 'B' },
    4: { fuel: 'S', organics: 'S', equipment: 'B' },
    5: { fuel: 'B', organics: 'S', equipment: 'S' },
    6: { fuel: 'S', organics: 'B', equipment: 'S' },
    7: { fuel: 'S', organics: 'S', equipment: 'S' },
    8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

export type MenuMode = 'sector' | 'port' | 'docked' | 'help' | 'shipInfo';
