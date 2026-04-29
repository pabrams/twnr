import { colorPalette, buildColors } from '../config/colors.js';

export const colors = buildColors(colorPalette);

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

