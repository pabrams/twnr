// Cross-universe constants.

export const globalConstants = {
    /** Sanity bounds for the bigbang sector count. */
    minSectorsPerUniverse: 20,
    maxSectorsPerUniverse: 100000,
    /**
     * Pinned logical xterm width in characters.
     */
    terminalCols: 80,
} as const;
