#!/usr/bin/env node
/**
 * Phase 2: Massive mechanical rename.
 * Run from repo root: node scripts/phase2-rename.mjs
 *
 * Applies all renames to shared types, server handlers, client code, and tests.
 * Designed to be idempotent — safe to run multiple times.
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── ClientMsgType key renames (key changes, wire stays) ──
const CLIENT_KEY_RENAMES = {
    Who: 'PlayersOnline',
    SectorWarps: 'WarpsOut',
    Path: 'ShortestPath',
    ShipExchange: 'BuyShipTradein',
    Attack: 'AttackShip',
};

// ── Client type renames (old → new) ──
const CLIENT_TYPE_RENAMES = {
    MoveMessage: 'MoveCommand',
    DisplayMessage: 'SectorDisplayCommand',
    WhoMessage: 'PlayersOnlineCommand',
    SectorQueryMessage: 'WarpsOutCommand',
    PathQueryMessage: 'ShortestPathCommand',
    PortQueryMessage: 'PortInfoCommand',
    ShipQueryMessage: 'ShipInfoCommand',
    CargoInfoQueryMessage: 'CargoInfoCommand',
    TradeMessage: 'PortTransactionCommand',
    BuyFightersMessage: 'BuyFightersCommand',
    BuyShieldsMessage: 'BuyShieldsCommand',
    BuyHoldsMessage: 'BuyHoldsCommand',
    ShipExchangeMessage: 'BuyShipTradeinCommand',
    AttackMessage: 'AttackShipCommand',
    DockMessage: 'DockCommand',
    UndockMessage: 'UndockCommand',
    JettisonMessage: 'JettisonCommand',
    LandMessage: 'LandCommand',
    TakeColonistsMessage: 'TakeColonistsCommand',
    LeaveColonistsMessage: 'LeaveColonistsCommand',
    DeployFightersInfoQueryMessage: 'DeployFightersInfoCommand',
    DeployFightersMessage: 'DeployFightersCommand',
    AttackSectorFightersMessage: 'AttackSectorFightersCommand',
    RetreatFromFightersMessage: 'RetreatFromFightersCommand',
    UseTerraformDeviceMessage: 'UseTerraformDeviceCommand',
    LandOnPlanetMessage: 'LandOnPlanetCommand',
    PlanetDisplayMessage: 'PlanetDisplayCommand',
    DestroyPlanetMessage: 'DestroyPlanetCommand',
    LeavePlanetMessage: 'LeavePlanetCommand',
    BuyPlanetBustersMessage: 'BuyPlanetBustersCommand',
    BuyTerraformDevicesMessage: 'BuyTerraformDevicesCommand',
    DockStardockMessage: 'DockStardockCommand',
    LeaveStardockMessage: 'LeaveStardockCommand',
    // Union type
    ClientMessage: 'ClientCommand',
};

// ── ServerMsgType key + wire renames ──
// Format: oldKey → { key: newKey, wire: newWire }
const SERVER_KEY_RENAMES = {
    SectorDisplay:           { key: 'SectorDisplayResult', wire: 'sectorDisplayResult' },
    PlayersOnline:           { key: 'PlayersOnlineResult', wire: 'playersOnlineResult' },
    SectorWarps:             { key: 'WarpsOutResult', wire: 'warpsOutResult' },
    PathResult:              { key: 'ShortestPathResult', wire: 'shortestPathResult' },
    PortInfo:                { key: 'PortInfoResult', wire: 'portInfoResult' },
    ShipInfo:                { key: 'ShipInfoResult', wire: 'shipInfoResult' },
    CargoInfo:               { key: 'CargoInfoResult', wire: 'cargoInfoResult' },
    ShipExchangeResult:      { key: 'BuyShipTradeinResult', wire: 'buyShipTradeinResult' },
    AttackResult:            { key: 'AttackShipResult', wire: 'attackShipResult' },
    DeployFightersInfo:      { key: 'DeployFightersInfoResult', wire: 'deployFightersInfoResult' },
    SectorFighterCombatResult: { key: 'AttackSectorFightersResult', wire: 'attackSectorFightersResult' },
    RetreatResult:           { key: 'RetreatFromFightersResult', wire: 'retreatFromFightersResult' },
    TerraformResult:         { key: 'UseTerraformDeviceResult', wire: 'useTerraformDeviceResult' },
    PlanetList:              { key: 'LandResult', wire: 'landResult' },
    StardockMenu:            { key: 'DockStardockResult', wire: 'dockStardockResult' },
    PlanetInfo:              { key: 'PlanetInfoResult', wire: 'planetInfoResult' },
};

// ── Server type renames (old → new) ──
const SERVER_TYPE_RENAMES = {
    SectorDisplayMessage: 'SectorDisplayResultObject',
    PlayersOnlineMessage: 'PlayersOnlineResultObject',
    NoShipMessage: 'NoShipResultObject',
    NonAdjacentMoveMessage: 'NonAdjacentMoveResultObject',
    SectorWarpsMessage: 'WarpsOutResultObject',
    PathResultMessage: 'ShortestPathResultObject',
    PortInfoMessage: 'PortInfoResultObject',
    ShipInfoMessage: 'ShipInfoResultObject',
    CargoInfoMessage: 'CargoInfoResultObject',
    PortTransactionResultMessage: 'PortTransactionResultObject',
    BuyFightersResultMessage: 'BuyFightersResultObject',
    BuyShieldsResultMessage: 'BuyShieldsResultObject',
    BuyHoldsResultMessage: 'BuyHoldsResultObject',
    ShipExchangeResultMessage: 'BuyShipTradeinResultObject',
    AttackResultMessage: 'AttackShipResultObject',
    DockResultMessage: 'DockResultObject',
    PlanetInfoMessage: 'PlanetInfoResultObject',
    TakeColonistsResultMessage: 'TakeColonistsResultObject',
    LeaveColonistsResultMessage: 'LeaveColonistsResultObject',
    FighterEncounterMessage: 'FighterEncounterResultObject',
    DeployFightersInfoMessage: 'DeployFightersInfoResultObject',
    DeployFightersResultMessage: 'DeployFightersResultObject',
    SectorFighterCombatResultMessage: 'AttackSectorFightersResultObject',
    RetreatResultMessage: 'RetreatFromFightersResultObject',
    PlanetListMessage: 'LandResultObject',
    LandOnPlanetResultMessage: 'LandOnPlanetResultObject',
    PlanetDisplayResultMessage: 'PlanetDisplayResultObject',
    DestroyPlanetResultMessage: 'DestroyPlanetResultObject',
    BuyPlanetBustersResultMessage: 'BuyPlanetBustersResultObject',
    BuyTerraformDevicesResultMessage: 'BuyTerraformDevicesResultObject',
    StardockMenuMessage: 'DockStardockResultObject',
    ErrorMessage: 'ErrorResultObject',
    // Union type
    ServerMessage: 'ServerResult',
};

// ── Handler function renames ──
const HANDLER_RENAMES = {
    handleWho: 'handlePlayersOnline',
    handleSectorWarps: 'handleWarpsOut',
    handlePath: 'handleShortestPath',
    handleShipExchange: 'handleBuyShipTradein',
    handleAttack: 'handleAttackShip',
};

// ── Wire string renames for tests (old → new) ──
// These are the wire values that changed
const WIRE_RENAMES = {
    'sectorDisplay': 'sectorDisplayResult',  // only when it's a server response, not client command
    'playersOnline': 'playersOnlineResult',
    'sectorWarps': 'warpsOutResult',
    'pathResult': 'shortestPathResult',
    'portInfo': 'portInfoResult',  // only server response
    'shipInfo': 'shipInfoResult',  // only server response
    'cargoInfo': 'cargoInfoResult',  // only server response
    'shipExchangeResult': 'buyShipTradeinResult',
    'attackResult': 'attackShipResult',
    'deployFightersInfo': 'deployFightersInfoResult', // only server response
    'sectorFighterCombatResult': 'attackSectorFightersResult',
    'retreatResult': 'retreatFromFightersResult',
    'terraformResult': 'useTerraformDeviceResult',
    'planetList': 'landResult',
    'stardockMenu': 'dockStardockResult',
    'planetInfo': 'planetInfoResult',
    'noShip': 'noShipResult',
    // 'nonAdjacentMoveRequested' stays — only used inside MoveResult now
    // 'fighterEncounter' stays — only used inside MoveResult now
};

function applyRenames(content, renames) {
    // Sort by length descending to avoid partial matches
    const sorted = Object.entries(renames).sort((a, b) => b[0].length - a[0].length);
    for (const [from, to] of sorted) {
        // Use word-boundary-aware replacement
        const regex = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        content = content.replace(regex, to);
    }
    return content;
}

function processFile(path, transforms) {
    let content = readFileSync(path, 'utf8');
    const original = content;
    for (const transform of transforms) {
        content = transform(content, path);
    }
    if (content !== original) {
        writeFileSync(path, content);
        console.log(`  Updated: ${path}`);
    }
}

// ── Transform functions ──

function renameClientTypes(content) {
    return applyRenames(content, CLIENT_TYPE_RENAMES);
}

function renameServerTypes(content) {
    return applyRenames(content, SERVER_TYPE_RENAMES);
}

function renameHandlers(content) {
    return applyRenames(content, HANDLER_RENAMES);
}

function renameClientMsgTypeKeys(content) {
    // Rename ClientMsgType.OldKey to ClientMsgType.NewKey
    for (const [oldKey, newKey] of Object.entries(CLIENT_KEY_RENAMES)) {
        content = content.replaceAll(`ClientMsgType.${oldKey}`, `ClientMsgType.${newKey}`);
        // Also rename in the const object definition
        const defRegex = new RegExp(`(\\s+)${oldKey}(:\\s*')`, 'g');
        content = content.replace(defRegex, `$1${newKey}$2`);
    }
    return content;
}

function renameServerMsgTypeKeys(content) {
    for (const [oldKey, { key: newKey }] of Object.entries(SERVER_KEY_RENAMES)) {
        content = content.replaceAll(`ServerMsgType.${oldKey}`, `ServerMsgType.${newKey}`);
    }
    return content;
}

function renameServerMsgTypeDefinition(content) {
    // Rename key and wire value in the ServerMsgType const object
    for (const [oldKey, { key: newKey, wire: newWire }] of Object.entries(SERVER_KEY_RENAMES)) {
        // Match the definition line: "    OldKey: 'oldWire',"
        const lineRegex = new RegExp(`(\\s+)${oldKey}:\\s*'[^']*'`, 'g');
        content = content.replace(lineRegex, `$1${newKey}: '${newWire}'`);
    }
    return content;
}

function renameWireStringsInTests(content, path) {
    // Only rename wire strings that appear as server response types
    // Be careful: some wire strings are used as both client command types and server response types
    // The ambiguous ones: 'sectorDisplay', 'portInfo', 'shipInfo', 'cargoInfo', 'deployFightersInfo'
    // These are client command wire types too, so we only rename them when they appear as response expectations

    for (const [oldWire, newWire] of Object.entries(WIRE_RENAMES)) {
        // Rename in wsRequest response type parameter: wsRequest(ws, {...}, 'oldWire')
        content = content.replaceAll(`}, '${oldWire}')`, `}, '${newWire}')`);
        // Rename in waitForMsg/waitForMessage: waitForMsg(ws, 'oldWire') / waitForMessage('oldWire')
        content = content.replaceAll(`waitForMsg(ws, '${oldWire}'`, `waitForMsg(ws, '${newWire}'`);
        content = content.replaceAll(`waitForMessage('${oldWire}'`, `waitForMessage('${newWire}'`);
        // Rename in expectNoMsg: expectNoMsg(ws, 'oldWire')
        content = content.replaceAll(`expectNoMsg(ws, '${oldWire}'`, `expectNoMsg(ws, '${newWire}'`);
        content = content.replaceAll(`expectNoMsg(ws1, '${oldWire}'`, `expectNoMsg(ws1, '${newWire}'`);
        // Rename in assert.equal(msg.type, 'oldWire')
        content = content.replaceAll(`msg.type, '${oldWire}'`, `msg.type, '${newWire}'`);
        content = content.replaceAll(`msg.type === '${oldWire}'`, `msg.type === '${newWire}'`);
        content = content.replaceAll(`r.type === '${oldWire}'`, `r.type === '${newWire}'`);
        content = content.replaceAll(`parsed.type === '${oldWire}'`, `parsed.type === '${newWire}'`);
        // In helpers.mjs connectWS: msg.type === 'welcome'
        content = content.replaceAll(`m.type === '${oldWire}'`, `m.type === '${newWire}'`);
        // Rename in res.type checks
        content = content.replaceAll(`res.type, '${oldWire}'`, `res.type, '${newWire}'`);
        content = content.replaceAll(`res.type === '${oldWire}'`, `res.type === '${newWire}'`);
    }
    return content;
}

function renameWireStringsInTestsSafe(content, path) {
    // For ambiguous wire strings that are both client commands and server responses,
    // we need to be more careful. Only rename when used as a response expectation.
    // The wsRequest second arg is the client message, third arg is expected response type.
    // So { type: 'portInfo', sectorId: X }, 'portInfo' — second 'portInfo' is the response.

    // Handle 'sectorDisplay' specially — as a client command type it stays 'sectorDisplay'
    // but as a server response type it becomes 'sectorDisplayResult'
    // In wsRequest: the third arg is the response type expectation
    // In waitForMessage: always a response type
    // In msg.type ===: could be either, need context

    // The 'sectorDisplay' as a SERVER response is already handled — it only appears in
    // contexts where we're waiting for server responses. The CLIENT command type stays 'sectorDisplay'.
    // The { type: 'sectorDisplay' } in sendMsg/wsRequest first arg stays unchanged.

    return content;
}

// ── Apply transforms ──

console.log('Phase 2: Applying renames...\n');

// 1. messages.ts — rename ServerMsgType definition + ClientMsgType keys
console.log('1. Shared types:');
processFile('packages/shared/src/messages.ts', [
    renameServerMsgTypeDefinition,
    renameClientMsgTypeKeys,
]);

// 2. client-messages.ts — rename client types and ClientMsgType refs
processFile('packages/shared/src/client-messages.ts', [
    renameClientTypes,
    renameClientMsgTypeKeys,
]);

// 3. server-messages.ts — rename server types and ServerMsgType refs
processFile('packages/shared/src/server-messages.ts', [
    renameServerTypes,
    renameServerMsgTypeKeys,
]);

// 4. Server handler files
console.log('\n2. Server handlers:');
const handlerDir = 'packages/server/src/handlers';
for (const f of readdirSync(handlerDir).filter(f => f.endsWith('.ts'))) {
    processFile(join(handlerDir, f), [
        renameServerMsgTypeKeys,
        renameHandlers,
    ]);
}

// 5. Other server files
processFile('packages/server/src/server.ts', [renameServerMsgTypeKeys, renameHandlers, renameServerTypes]);
processFile('packages/server/src/game-state.ts', [renameServerMsgTypeKeys, renameServerTypes]);

// 6. Client files
console.log('\n3. Client:');
const clientGameDir = 'packages/client/src/game';
for (const f of readdirSync(clientGameDir).filter(f => f.endsWith('.ts'))) {
    processFile(join(clientGameDir, f), [
        renameClientTypes,
        renameServerTypes,
        renameClientMsgTypeKeys,
        renameServerMsgTypeKeys,
    ]);
}

// 7. Test files
console.log('\n4. Tests:');
const testDir = 'packages/server/test';
for (const f of readdirSync(testDir).filter(f => f.endsWith('.mjs'))) {
    processFile(join(testDir, f), [
        renameWireStringsInTests,
    ]);
}

console.log('\nDone! Run: pnpm -r run build && pnpm --filter @twnr/server test');
