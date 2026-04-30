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
    showMoveMenu: vi.fn(),
}));
vi.mock('../src/game/display-port.js', () => ({
    showClass0Menu: vi.fn(),
    showClass0QtyPrompt: vi.fn(),
    showJettisonConfirm: vi.fn(),
}));
vi.mock('../src/game/display-planet.js', () => ({
    showPlanetMenu: vi.fn(),
    showPlanetMenuOptions: vi.fn(),
    showEarthMenu: vi.fn(),
    showNoPlanet: vi.fn(),
    showPlanetTakePrompt: vi.fn(),
    showPlanetLeavePrompt: vi.fn(),
    showPlanetTakeCommodityMenu: vi.fn(),
    showPlanetLeaveCommodityMenu: vi.fn(),
}));
vi.mock('../src/game/display-combat.js', () => ({
    showDroneEncounter: vi.fn(),
    showDroneEncounterPrompt: vi.fn(),
    showAttackMenu: vi.fn(),
    showAttackPrompt: vi.fn(),
    showAttackDronesPrompt: vi.fn(),
    showDroneAttackQtyPrompt: vi.fn(),
}));
vi.mock('../src/game/display-starbase.js', () => ({
    showStarbaseMenu: vi.fn(),
    showHardwareMenu: vi.fn(),
    showPlanetSelectMenu: vi.fn(),
    showShipyardsMenu: vi.fn(),
    showShipyardsClass0Menu: vi.fn(),
    showShipyardsClass0QtyPrompt: vi.fn(),
    showShipBuyList: vi.fn(),
    showShipyardsBuyPrompt: vi.fn(),
    showShipExamineList: vi.fn(),
    showTradeinPrompt: vi.fn(),
    showBuyQtyPrompt: vi.fn(),
}));
vi.mock('../src/game/display-computer.js', () => ({
    renderVisitedSectorsResult: vi.fn(),
    showComputerPrompt: vi.fn(),
    showKnownUniverseMenu: vi.fn(),
    showShipCatalog: vi.fn(),
    showPlanetSpecs: vi.fn(),
    showPlanetSpecsPrompt: vi.fn(),
}));
vi.mock('../src/game/input.js', () => ({
    drainInputQueue: vi.fn(),
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

function createMockCtx(overrides: { autopilot?: Partial<GameContext['autopilot']> } = {}): GameContext {
    return {
        io: {
            term: {
                writeln: vi.fn(),
                write: vi.fn(),
            } as unknown as GameContext['io']['term'],
            ws: {} as WebSocket,
            sendMsg: vi.fn(),
            setDebug: vi.fn(),
            debug: false,
            submitLineFromMap: vi.fn(),
        },
        input: {
            userInputBuffer: [],
            inputQueue: [],
            inFlight: false,
            inputAssembly: '',
        },
        player: {
            universeId: 1,
            name: 'Test',
            id: 1,
            isAdmin: false,
        },
        world: {
            mode: Menu.Sector as MenuName,
            currentSector: 1,
            currentPort: null,
            dockedPortInfo: null,
            visitedSet: new Set<number>(),
            totalSectors: 100,
            sectorPlayers: [],
            currentWarps: [],
            starbaseSector: null,
        },
        ship: {
            currentShipName: 'Vulpeculan Cruiser',
            currentColoredShipName: null,
            shipColonists: 0,
            planetEmptyHolds: 0,
        },
        autopilot: {
            path: [],
            step: 0,
            paused: false,
            ...overrides.autopilot,
        },
        encounter: {
            attackTarget: null,
            ownerName: '',
        },
        catalogs: {
            hardware: null,
            ships: null,
            planets: null,
            class0Prices: null,
            hardwarePrices: null,
            menus: new Map(),
        },
        starbase: {
            class0ShipState: null,
            hardwareStoreCredits: 0,
            hardwareStoreItems: [],
        },
        minimap: {
            knownUniverseMode: 'explored',
        },
        pendingMenuArgs: null,
    };
}

function envelope(menu: string, payload: Record<string, unknown>) {
    return { data: JSON.stringify({ ...payload, menu }) };
}

describe('connection message handler', () => {
    describe('autopilot resilience', () => {
        it('recovers when the server sends unexpected messages during rapid movement', () => {
            vi.useFakeTimers();
            const ws = createMockWS();
            const ctx = createMockCtx({
                autopilot: { path: [1, 10, 20, 30], step: 3 },
            });
            setupConnection(ws as unknown as WebSocket, ctx, () => {});
            ws.fire('message', envelope('sector', { type: ServerMsgType.RateLimited }));
            vi.advanceTimersByTime(500);
            expect(ctx.io.sendMsg).toHaveBeenCalled();

            vi.useRealTimers();
        });

        it('completes autopilot after recovering from a disruption mid-flight', () => {
            vi.useFakeTimers();
            const ws = createMockWS();
            const ctx = createMockCtx({
                autopilot: { path: [1, 10, 20], step: 3 },
            });
            setupConnection(ws as unknown as WebSocket, ctx, () => {});

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

            expect(ctx.autopilot.path).toEqual([]);
            expect(ctx.autopilot.step).toBe(0);

            vi.useRealTimers();
        });


    });
});
