import '@xterm/xterm/css/xterm.css';
import { setupAuthScreen } from './screens/auth.js';
import { setupUniverseScreen } from './screens/universe-select.js';
import { startGame } from './game/index.js';

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

function showScreen(screen: 'auth' | 'universes' | 'playerName' | 'game') {
    authDiv.style.display = screen === 'auth' ? 'flex' : 'none';
    universeDiv.style.display = screen === 'universes' ? 'flex' : 'none';
    playerNameDiv.style.display = screen === 'playerName' ? 'flex' : 'none';
    termDiv.style.display = screen === 'game' ? 'block' : 'none';
}

const { showUniverseSelect } = setupUniverseScreen(
    {
        universeList,
        universeError,
        playerNameDiv,
        playerNameInput,
        playerNameError,
        playerNameSubmit,
    },
    showScreen,
    (universeId) => {
        showScreen('game');
        startGame(universeId, termDiv);
    },
);

setupAuthScreen({ nameInput, emailInput, passwordInput, submitBtn, toggleBtn, errorDiv }, () =>
    showUniverseSelect(),
);
