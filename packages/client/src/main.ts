import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ServerMessage, ClientMessage } from '@twnr/shared';

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
term.open(document.getElementById('terminal')!);
fitAddon.fit();

window.addEventListener('resize', () => fitAddon.fit());

const ws = new WebSocket(`ws://${location.host}/ws`);

ws.addEventListener('open', () => {
  term.writeln('Connected to TWNR.');
});

ws.addEventListener('message', (event) => {
  const msg: ServerMessage = JSON.parse(event.data);
  switch (msg.type) {
    case 'welcome':
      term.writeln(`\r\nWelcome, ${msg.name}. You are in sector ${msg.sector}.`);
      break;
    case 'playerMoved':
      term.writeln(`\r\nPlayer ${msg.playerId} moved to sector ${msg.sector}.`);
      break;
    case 'sectorDisplay':
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

// Send raw input line by line
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
    inputBuffer += key;
    term.write(key);
  }
});

function sendMsg(msg: ClientMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleInput(line: string) {
  const [cmd, ...args] = line.split(/\s+/);
  switch (cmd.toLowerCase()) {
    case 'd':
    case 'display':
      sendMsg({ type: 'display' });
      break;
    case 'm':
    case 'move': {
      const sector = parseInt(args[0], 10);
      if (!isNaN(sector)) sendMsg({ type: 'move', sector });
      else term.writeln('Usage: move <sector>');
      break;
    }
    default:
      if (line) term.writeln(`Unknown command: ${cmd}`);
  }
}
