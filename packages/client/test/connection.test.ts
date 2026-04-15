import { describe, it, expect, vi } from 'vitest';
import { ServerMsgType, Menu } from '@twnr/shared';
import type { MenuName } from '@twnr/shared';
import type { GameContext } from '../src/game/types.js';

vi.mock('../src/game/display.js', () => ({
    showSectorDisplay: vi.fn(),
    showCommerceReport: vi.fn(),
    showPrompt: vi.fn(),
    showPortMenu: vi.fn(),
    showHelp: vi.fn(),
    showPlayerInfo: vi.fn(),
}));
vi.mock('../src/game/display-port.js', () => ({
    showClass0Menu: vi.fn(),
    showAutopilotPrompt: vi.fn(),
    showTradeQtyPrompt: vi.fn(),
}));
vi.mock('../src/game/display-planet.js', () => ({
    showPlanetMenu: vi.fn(),
    showPlanetMenuOptions: vi.fn(),
    showEarthMenu: vi.fn(),
    showNoPlanet: vi.fn(),
}));
vi.mock('../src/game/display-combat.js', () => ({
    showDroneEncounter: vi.fn(),
}));
vi.mock('../src/game/display-starbase.js', () => ({
    showStarbaseMenu: vi.fn(),
    showHardwareMenu: vi.fn(),
    showPlanetSelectMenu: vi.fn(),
    showShipyardsMenu: vi.fn(),
    showShipyardsClass0Menu: vi.fn(),
}));
vi.mock('../src/game/display-computer.js', () => ({
    renderVisitedSectorsResult: vi.fn(),
    showComputerPrompt: vi.fn(),
}));

import { setupConnection } from '../src/game/connection.js';

function createMockWS() {
    const listeners: Record<string, Function[]> = {};
    return {
        addEventListener(event: string, fn: Function) {
            (listeners[event] ??= []).push(fn);
        },
        removeEventListener(event: string, fn: Function) {
            const arr = listeners[event];
            if (arr) listeners[event] = arr.filter((f) => f !== fn);
        },
        send: vi.fn(),
        readyState: 1, // OPEN
        OPEN: 1,
        fire(event: string, data?: unknown) {
            for (const fn of listeners[event] ?? []) fn(data);
        },
    };
}

function createMockCtx(overrides: Partial<GameContext> = {}): GameContext {
    return {
        term: { writeln: vi.fn(), write: vi.fn() } as unknown as GameContext['term'],
        ws: {} as WebSocket,
        universeId: 1,
        sendMsg: vi.fn(),
        changeMenu: vi.fn(),
        setDebug: vi.fn(),
        mode: Menu.Sector as MenuName,
        currentSector: 1,
        currentPort: null,
        dockedPortInfo: null,
        visitedSet: new Set<number>(),
        playerName: 'Test',
        playerId: 1,
        totalSectors: 100,
        sectorPlayers: [],
        attackTarget: null,
        class0BuyType: null,
        shipConfigs: null,
        planetConfigs: null,
        currentShipName: 'Vulpeculan Cruiser',
        class0Prices: null,
        autopilotPath: [],
        autopilotStep: 0,
        autopilotPaused: false,
        encounterOwnerName: '',
        debug: false,
        menuRegistry: new Map(),
        starbaseSector: null,
        hardwarePrices: null,
        colonistCommodity: null,
        knownUniverseMode: 'explored',
        starbaseBuyItemName: null,
        shipyardsBuyTarget: null,
        landablePlanets: null,
        ...overrides,
    } as GameContext;
}

function envelope(menu: string, payload: unknown) {
    return { data: JSON.stringify({ menu, payload }) };
}

describe('connection message handler', () => {
    describe('autopilot resilience', () => {
        it('recovers when the server sends unexpected messages during rapid movement', () => {
            vi.useFakeTimers();
            const ws = createMockWS();
            const ctx = createMockCtx({
                autopilotPath: [1, 10, 20, 30],
                autopilotStep: 3,
            });
            setupConnection(ws as unknown as WebSocket, ctx);
            ws.fire('message', envelope('sector', { type: ServerMsgType.RateLimited }));
            vi.advanceTimersByTime(500);
            expect(ctx.sendMsg).toHaveBeenCalled();

            vi.useRealTimers();
        });

        it('completes autopilot after recovering from a disruption mid-flight', () => {
            vi.useFakeTimers();
            const ws = createMockWS();
            const ctx = createMockCtx({
                autopilotPath: [1, 10, 20],
                autopilotStep: 3,
            });
            setupConnection(ws as unknown as WebSocket, ctx);

            ws.fire('message', envelope('sector', { type: ServerMsgType.RateLimited }));
            vi.advanceTimersByTime(500);

            ws.fire(
                'message',
                envelope('sector', {
                    type: ServerMsgType.MoveResult,
                    outcome: 'success',
                    sector: 20,
                    warps: [{ sector: 10, visited: true }],
                    players: [],
                    port: null,
                    sectorDrones: null,
                    planets: [],
                    collisions: [],
                }),
            );

            expect(ctx.autopilotPath).toEqual([]);
            expect(ctx.autopilotStep).toBe(0);

            vi.useRealTimers();
        });


    });
});
