// Auth

export type AuthTokenPayload = {
    userId: number;
    name?: string;
    role?: string;
    tokenVersion: number;
};

// HTTP API response shapes (auth & admin only)

export type AuthResponse = {
    userId: number;
    name?: string;
    role: string;
    token: string;
};

export type LogoutResponse = {
    success: boolean;
};

export type ServerStatsResponse = {
    uptime: number;
    playersOnline: number;
    totalPlayers: number;
    totalSectors: number;
    nodeVersion: string;
    platform: string;
};
