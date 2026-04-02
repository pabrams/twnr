import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ServerMsgType, ClientMsgType } from '@twnr/shared';
import type { ServerMessage, ClientMessage } from '@twnr/shared';

const authDiv = document.getElementById('auth')!;
const termDiv = document.getElementById('terminal')!;
const nameInput = document.getElementById('auth-name') as HTMLInputElement;
const emailInput = document.getElementById('auth-email') as HTMLInputElement;
const passwordInput = document.getElementById('auth-password') as HTMLInputElement;
const submitBtn = document.getElementById('auth-submit') as HTMLButtonElement;
const toggleBtn = document.getElementById('auth-toggle') as HTMLButtonElement;
const errorDiv = document.getElementById('auth-error')!;

const universeDiv = document.getElementById('universe-select')!;
const universeList = document.getElementById('universe-list')!;
const universeError = document.getElementById('universe-error')!;

const playerNameDiv = document.getElementById('player-name-prompt')!;
const playerNameInput = document.getElementById('player-name-input') as HTMLInputElement;
const playerNameError = document.getElementById('player-name-error')!;
const playerNameSubmit = document.getElementById('player-name-submit') as HTMLButtonElement;

let isLogin = false;

function updateAuthMode() {
    nameInput.style.display = isLogin ? 'none' : '';
    submitBtn.textContent = isLogin ? 'Log in' : 'Register';
    toggleBtn.textContent = isLogin
        ? "Don't have an account? Register"
        : 'Already have an account? Log in';
    errorDiv.textContent = '';
}

toggleBtn.addEventListener('click', () => {
    isLogin = !isLogin;
    updateAuthMode();
});

function showScreen(screen: 'auth' | 'universes' | 'playerName' | 'game') {
    authDiv.style.display = screen === 'auth' ? 'flex' : 'none';
    universeDiv.style.display = screen === 'universes' ? 'flex' : 'none';
    playerNameDiv.style.display = screen === 'playerName' ? 'flex' : 'none';
    termDiv.style.display = screen === 'game' ? 'block' : 'none';
}

async function handleAuth() {
    errorDiv.textContent = '';
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const name = nameInput.value.trim();

    if (!email || !password || (!isLogin && !name)) {
        errorDiv.textContent = 'All fields are required.';
        return;
    }

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const body = isLogin ? { email, password } : { name, email, password };

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            errorDiv.textContent = data.error || 'Something went wrong.';
            return;
        }
        showUniverseSelect();
    } catch {
        errorDiv.textContent = 'Could not reach server.';
    }
}

submitBtn.addEventListener('click', handleAuth);
passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuth();
});

interface UniverseInfo {
    id: number;
    name: string;
    playerId: number | null;
    playerName: string | null;
}

async function showUniverseSelect() {
    universeError.textContent = '';
    universeList.innerHTML = '';

    try {
        const res = await fetch('/api/universes');
        if (!res.ok) {
            universeError.textContent = 'Failed to load universes.';
            showScreen('universes');
            return;
        }
        const universes: UniverseInfo[] = await res.json();

        if (universes.length === 0) {
            universeError.textContent = 'No universes available.';
            showScreen('universes');
            return;
        }

        for (const u of universes) {
            const li = document.createElement('li');
            const nameSpan = document.createElement('div');
            nameSpan.textContent = u.name;
            li.appendChild(nameSpan);

            if (u.playerName) {
                const status = document.createElement('div');
                status.className = 'player-status';
                status.textContent = `Playing as: ${u.playerName}`;
                li.appendChild(status);
            } else {
                const status = document.createElement('div');
                status.className = 'player-status';
                status.textContent = 'New player';
                li.appendChild(status);
            }

            li.addEventListener('click', () => selectUniverse(u));
            universeList.appendChild(li);
        }

        showScreen('universes');
    } catch {
        universeError.textContent = 'Could not reach server.';
        showScreen('universes');
    }
}

let selectedUniverse: UniverseInfo | null = null;

function selectUniverse(u: UniverseInfo) {
    if (u.playerId) {
        startGame(u.id);
    } else {
        selectedUniverse = u;
        playerNameInput.value = '';
        playerNameError.textContent = '';
        showScreen('playerName');
    }
}

playerNameSubmit.addEventListener('click', joinUniverse);
playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinUniverse();
});

async function joinUniverse() {
    if (!selectedUniverse) return;
    const name = playerNameInput.value.trim();
    if (!name) {
        playerNameError.textContent = 'Name is required.';
        return;
    }

    try {
        const res = await fetch(`/api/universes/${selectedUniverse.id}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) {
            playerNameError.textContent = data.error || 'Failed to join.';
            return;
        }
        startGame(selectedUniverse.id);
    } catch {
        playerNameError.textContent = 'Could not reach server.';
    }
}

const PORT_CLASS_LABELS: Record<number, string> = {
    0: 'Special',
    1: 'BBS', 2: 'BSB', 3: 'SBB', 4: 'SSB',
    5: 'BSS', 6: 'SBS', 7: 'SSS', 8: 'BBB',
    9: 'Special',
};

const PORT_CLASS_ACTIONS: Record<number, Record<string, 'B' | 'S'>> = {
    1: { fuel: 'B', organics: 'B', equipment: 'S' },
    2: { fuel: 'B', organics: 'S', equipment: 'B' },
    3: { fuel: 'S', organics: 'B', equipment: 'B' },
    4: { fuel: 'S', organics: 'S', equipment: 'B' },
    5: { fuel: 'B', organics: 'S', equipment: 'S' },
    6: { fuel: 'S', organics: 'B', equipment: 'S' },
    7: { fuel: 'S', organics: 'S', equipment: 'S' },
    8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

type MenuMode = 'sector' | 'port' | 'docked' | 'help' | 'shipInfo';

function startGame(universeId: number) {
    showScreen('game');

    const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 14,
        theme: {
            background: '#000000',
            foreground: '#c0c0c0',
        },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termDiv);
    fitAddon.fit();

    window.addEventListener('resize', () => fitAddon.fit());

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProtocol}://${location.host}/ws?universe=${universeId}`);

    let mode: MenuMode = 'sector';
    let currentSector = 0;
    let currentPort: { class: number; name: string } | null = null;
    let dockedPortInfo: import('@twnr/shared').PortInfoMessage | null = null;

    function sendMsg(msg: ClientMessage) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    function showSectorDisplay(sector: number, warps: number[], players: { id: number; name: string }[], port?: { class: number; name: string } | null) {
        currentSector = sector;
        currentPort = port ?? null;
        term.writeln('');
        term.writeln(`Sector ${sector}`);
        if (port) {
            const label = PORT_CLASS_LABELS[port.class] ?? '???';
            term.writeln(`  Port ${port.name}, Class ${port.class} (${label})`);
        }
        if (warps.length > 0) {
            term.writeln(`  Warps to: ${warps.join(', ')}`);
        }
        if (players.length > 0) {
            for (const p of players) {
                term.writeln(`  ${p.name} is in this sector`);
            }
        }
        showPrompt();
    }

    function showPrompt() {
        term.write(`\r\nCommand [${currentSector}] (?=Help) : `);
    }

    function showHelp() {
        mode = 'help';
        term.writeln('');
        term.writeln('Commands:');
        term.writeln('  <number>  Move to sector');
        term.writeln('  D         Display current sector');
        term.writeln('  P         Port menu (if port in sector)');
        term.writeln('  I         Ship & cargo info');
        term.writeln('  ?         This help');
        term.writeln('  Q         Return to game');
    }

    function showPortMenu() {
        if (!currentPort) {
            term.writeln('\r\nNo port in this sector.');
            showPrompt();
            return;
        }
        mode = 'port';
        const label = PORT_CLASS_LABELS[currentPort.class] ?? '???';
        term.writeln('');
        term.writeln(`Port ${currentPort.name}, Class ${currentPort.class} (${label})`);
        term.writeln('  T  Trade at this port');
        term.writeln('  Q  Never mind');
    }

    function showDockedMenu() {
        if (!dockedPortInfo) return;
        const p = dockedPortInfo;
        const actions = PORT_CLASS_ACTIONS[p.class];
        term.writeln('');
        term.writeln(`Docked at Port ${p.sectorId}, Class ${p.class}`);
        if (actions) {
            term.writeln('  Commodity     Price   Stock   Port');
            const goods = [
                { name: 'Fuel', key: 'fuel', price: p.fuelPrice, stock: p.fuel },
                { name: 'Organics', key: 'organics', price: p.orgPrice, stock: p.organics },
                { name: 'Equipment', key: 'equipment', price: p.equPrice, stock: p.equipment },
            ];
            for (const g of goods) {
                const action = actions[g.key];
                const dir = action === 'B' ? 'Buying' : 'Selling';
                term.writeln(`  ${g.name.padEnd(14)} ${String(g.price).padStart(5)}   ${String(g.stock).padStart(5)}   ${dir}`);
            }
            term.writeln('');
            term.writeln('  B <good> <qty>  Buy from port');
            term.writeln('  S <good> <qty>  Sell to port');
        } else {
            term.writeln('  This is a special port.');
        }
        term.writeln('  Q  Leave port');
    }

    function showShipInfo() {
        mode = 'shipInfo';
        sendMsg({ type: ClientMsgType.ShipInfo });
        sendMsg({ type: ClientMsgType.CargoInfo });
    }

    ws.addEventListener('open', () => {
        term.writeln('Connected to TWNR.');
    });

    ws.addEventListener('message', (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
            case ServerMsgType.Welcome:
                term.writeln(`\r\nWelcome, ${msg.name}.`);
                sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case ServerMsgType.PlayerMoved:
                if (msg.direction === 'in') {
                    term.writeln(`\r\nPlayer warped into the sector.`);
                } else {
                    term.writeln(`\r\nPlayer warped out of the sector.`);
                }
                break;
            case ServerMsgType.SectorDisplay:
                showSectorDisplay(msg.sector, msg.warps, msg.players, msg.port);
                break;
            case ServerMsgType.DockResult:
                if (msg.docked && msg.port) {
                    dockedPortInfo = msg.port;
                    mode = 'docked';
                    showDockedMenu();
                } else {
                    dockedPortInfo = null;
                    mode = 'sector';
                    term.writeln('\r\nYou undock from the port.');
                    sendMsg({ type: ClientMsgType.SectorDisplay });
                }
                break;
            case ServerMsgType.PortTransactionResult:
                term.writeln(`\r\nTransaction complete. Credits: ${msg.credits}`);
                term.writeln(`  Cargo — Fuel: ${msg.cargo.fuel}, Organics: ${msg.cargo.organics}, Equipment: ${msg.cargo.equipment}`);
                if (mode === 'docked') showDockedMenu();
                break;
            case ServerMsgType.ShipInfo:
                term.writeln('');
                term.writeln(`Ship: ${msg.shipName}`);
                term.writeln(`  Fighters: ${msg.fighters}/${msg.maxFighters}  Shields: ${msg.shields}/${msg.maxShields}`);
                term.writeln(`  Cargo holds: ${msg.holdsAvailable} free / ${msg.cargoLimit} total (max ${msg.maxHolds})`);
                term.writeln(`  Fuel: ${msg.cargoFuel}  Organics: ${msg.cargoOrganics}  Equipment: ${msg.cargoEquipment}`);
                break;
            case ServerMsgType.CargoInfo:
                term.writeln(`  Credits: ${msg.credits}`);
                if (mode === 'shipInfo') {
                    mode = 'sector';
                    term.writeln('');
                    term.writeln('Press Q to return.');
                }
                break;
            case ServerMsgType.NonAdjacentMoveRequested:
                term.writeln(`\r\nCannot move to sector ${msg.sector} — not adjacent.`);
                showPrompt();
                break;
            case ServerMsgType.Error:
                term.writeln(`\r\nError: ${msg.message}`);
                if (mode === 'docked') showDockedMenu();
                else if (mode === 'sector') showPrompt();
                break;
        }
    });

    ws.addEventListener('close', () => {
        term.writeln('\r\nDisconnected.');
    });

    ws.addEventListener('error', () => {
        term.writeln('\r\nConnection error.');
    });

    const singleCharCommands = new Set(['d', 'p', 'i', '?', 'q', 't']);

    let inputBuffer = '';
    term.onKey(({ key, domEvent }) => {
        if (domEvent.key === 'Enter') {
            term.writeln('');
            handleInput(inputBuffer.trim());
            inputBuffer = '';
        } else if (domEvent.key === 'Backspace') {
            if (inputBuffer.length > 0) {
                inputBuffer = inputBuffer.slice(0, -1);
                term.write('\b \b');
            }
        } else {
            const lower = key.toLowerCase();
            if (inputBuffer === '' && singleCharCommands.has(lower)) {
                term.writeln(key);
                handleInput(lower);
            } else {
                inputBuffer += key;
                term.write(key);
            }
        }
    });

    function handleInput(line: string) {
        switch (mode) {
            case 'help':
            case 'shipInfo':
                if (line.toLowerCase() === 'q') {
                    mode = 'sector';
                    showPrompt();
                }
                return;
            case 'port':
                handlePortInput(line);
                return;
            case 'docked':
                handleDockedInput(line);
                return;
        }

        // Sector mode
        const [cmd, ...args] = line.split(/\s+/);
        if (/^\d+$/.test(cmd)) {
            sendMsg({ type: ClientMsgType.Move, sector: parseInt(cmd, 10) });
            return;
        }
        switch (cmd.toLowerCase()) {
            case '':
            case 'd':
                sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case 'p':
                showPortMenu();
                break;
            case 'i':
                showShipInfo();
                break;
            case '?':
                showHelp();
                break;
            case 'm':
            case 'move': {
                const sector = parseInt(args[0], 10);
                if (!isNaN(sector)) sendMsg({ type: ClientMsgType.Move, sector });
                else term.writeln('Usage: move <sector>');
                break;
            }
            default:
                if (line) term.writeln(`Unknown command: ${cmd}`);
                showPrompt();
        }
    }

    function handlePortInput(line: string) {
        switch (line.toLowerCase()) {
            case 't':
                sendMsg({ type: ClientMsgType.Dock });
                break;
            case 'q':
                mode = 'sector';
                showPrompt();
                break;
            default:
                term.writeln('  T  Trade at this port');
                term.writeln('  Q  Never mind');
        }
    }

    function handleDockedInput(line: string) {
        const [cmd, ...args] = line.split(/\s+/);
        switch (cmd.toLowerCase()) {
            case 'b':
            case 'buy': {
                const good = args[0]?.toLowerCase();
                const qty = parseInt(args[1], 10);
                if (!good || isNaN(qty) || qty <= 0) {
                    term.writeln('Usage: b <fuel|organics|equipment> <quantity>');
                    return;
                }
                sendMsg({ type: ClientMsgType.PortTransaction, good, quantity: qty, action: 'buy' });
                break;
            }
            case 's':
            case 'sell': {
                const good = args[0]?.toLowerCase();
                const qty = parseInt(args[1], 10);
                if (!good || isNaN(qty) || qty <= 0) {
                    term.writeln('Usage: s <fuel|organics|equipment> <quantity>');
                    return;
                }
                sendMsg({ type: ClientMsgType.PortTransaction, good, quantity: qty, action: 'sell' });
                break;
            }
            case 'q':
            case 'leave':
                sendMsg({ type: ClientMsgType.Undock });
                break;
            default:
                showDockedMenu();
        }
    }
}

updateAuthMode();
