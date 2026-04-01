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
        startGame();
    } catch {
        errorDiv.textContent = 'Could not reach server.';
    }
}

submitBtn.addEventListener('click', handleAuth);
passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuth();
});

function startGame() {
    authDiv.style.display = 'none';
    termDiv.style.display = 'block';

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
    const ws = new WebSocket(`${wsProtocol}://${location.host}/ws`);

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
