import '@xterm/xterm/css/xterm.css';
import { setupAuthScreen } from './screens/auth.js';
import { setupUniverseScreen } from './screens/universe-select.js';
import { setupAdminScreen } from './screens/admin.js';
import { startGame } from './game/index.js';

const authDiv = document.getElementById('auth')!;
const gameContainer = document.getElementById('game-container')!;
const termDiv = document.getElementById('terminal')!;
const nameInput = document.getElementById('auth-name') as HTMLInputElement;
const emailInput = document.getElementById('auth-email') as HTMLInputElement;
const passwordInput = document.getElementById('auth-password') as HTMLInputElement;
const submitBtn = document.getElementById('auth-submit') as HTMLButtonElement;
const toggleBtn = document.getElementById('auth-toggle') as HTMLButtonElement;
const guestBtn = document.getElementById('auth-guest') as HTMLButtonElement;
const errorDiv = document.getElementById('auth-error')!;

const universeDiv = document.getElementById('universe-select')!;
const universeList = document.getElementById('universe-list')!;
const universeError = document.getElementById('universe-error')!;

const playerNameDiv = document.getElementById('player-name-prompt')!;
const playerNameInput = document.getElementById('player-name-input') as HTMLInputElement;
const playerNameError = document.getElementById('player-name-error')!;
const playerNameSubmit = document.getElementById('player-name-submit') as HTMLButtonElement;

const adminDiv = document.getElementById('admin')!;
const adminBtn = document.getElementById('admin-btn') as HTMLButtonElement;

function showScreen(screen: 'auth' | 'universes' | 'playerName' | 'game' | 'admin') {
    authDiv.style.display = screen === 'auth' ? 'flex' : 'none';
    universeDiv.style.display = screen === 'universes' ? 'flex' : 'none';
    playerNameDiv.style.display = screen === 'playerName' ? 'flex' : 'none';
    gameContainer.style.display = screen === 'game' ? 'flex' : 'none';
    adminDiv.style.display = screen === 'admin' ? 'flex' : 'none';
}

const { showUniverseSelect } = setupUniverseScreen({
    elements: {
        universeList,
        universeError,
        playerNameDiv,
        playerNameInput,
        playerNameError,
        playerNameSubmit,
    },
    showScreen,
    onStart: (universeId) => {
        showScreen('game');
        startGame(universeId, termDiv, () => {
            showUniverseSelect();
        });
    },
});

let adminInitialized = false;
adminBtn.addEventListener('click', () => {
    showScreen('admin');
    if (!adminInitialized) {
        setupAdminScreen(adminDiv, () => {
            showScreen('universes');
        });
        adminInitialized = true;
    }
});

setupAuthScreen({
    elements: { nameInput, emailInput, passwordInput, submitBtn, toggleBtn, guestBtn, errorDiv },
    onSuccess: (data) => {
        adminBtn.style.display = data.role === 'admin' ? '' : 'none';
        showUniverseSelect();
    },
    onGuestSuccess: (universeId) => {
        adminBtn.style.display = 'none';
        showScreen('game');
        startGame(universeId, termDiv, () => {
            showUniverseSelect();
        });
    },
});
