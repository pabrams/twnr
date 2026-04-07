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

// Server envelope: wraps every WS response with the player's current menu
export type ServerEnvelope<T = import('./server-messages.js').ServerResult> = {
    menu: string;
    payload: T;
};

// Menu registry types (fetched via /api/menu-registry)
export type MenuCommandEntry = {
    command: string;
    keyPattern: string;
    label: string;
    clientMsgType: string | null;
    targetMenu: string | null;
    sortOrder: number;
};

export type MenuEntry = {
    name: string;
    label: string;
    parentMenu: string | null;
    commands: MenuCommandEntry[];
};
