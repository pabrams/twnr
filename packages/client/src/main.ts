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

    ws.addEventListener('open', () => {
        term.writeln('Connected to TWNR.');
    });

    ws.addEventListener('message', (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
            case ServerMsgType.Welcome:
                term.writeln(`\r\nWelcome, ${msg.name}. You are in sector ${msg.sector}.`);
                break;
            case ServerMsgType.PlayerMoved:
                if (msg.direction === 'in') {
                    term.writeln(`\r\nPlayer ${msg.playerId} warped into the sector.`);
                } else {
                    term.writeln(`\r\nPlayer ${msg.playerId} warped out of the sector.`);
                }
                break;
            case ServerMsgType.SectorDisplay:
                term.writeln(`\r\nSector ${msg.sector} — warps: ${msg.warps.join(', ')}`);
                break;
        }
    });

    ws.addEventListener('close', () => {
        term.writeln('\r\nDisconnected.');
    });

    ws.addEventListener('error', () => {
        term.writeln('\r\nConnection error.');
    });

    const singleCharCommands = new Set(['d']);

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

    function sendMsg(msg: ClientMessage) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }

    function handleInput(line: string) {
        const [cmd, ...args] = line.split(/\s+/);
        if (/^\d+$/.test(cmd)) {
            const sector = parseInt(cmd, 10);
            sendMsg({ type: ClientMsgType.Move, sector });
            return;
        }
        switch (cmd.toLowerCase()) {
            case '':
            case 'd':
            case 'sectorDisplay':
                sendMsg({ type: ClientMsgType.SectorDisplay });
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
        }
    }
}

updateAuthMode();
