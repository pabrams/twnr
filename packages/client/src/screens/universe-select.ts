export interface UniverseInfo {
    id: number;
    name: string;
    playerId: number | null;
    playerName: string | null;
}

export function setupUniverseScreen(
    elements: {
        universeList: HTMLElement;
        universeError: HTMLElement;
        playerNameDiv: HTMLElement;
        playerNameInput: HTMLInputElement;
        playerNameError: HTMLElement;
        playerNameSubmit: HTMLButtonElement;
    },
    showScreen: (screen: 'auth' | 'universes' | 'playerName' | 'game' | 'admin') => void,
    onStart: (universeId: number) => void,
) {
    let selectedUniverse: UniverseInfo | null = null;

    async function showUniverseSelect() {
        elements.universeError.textContent = '';
        elements.universeList.innerHTML = '';

        try {
            const res = await fetch('/api/universes');
            if (!res.ok) {
                elements.universeError.textContent = 'Failed to load universes.';
                showScreen('universes');
                return;
            }
            const universes: UniverseInfo[] = await res.json();

            if (universes.length === 0) {
                elements.universeError.textContent = 'No universes available.';
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
                elements.universeList.appendChild(li);
            }

            showScreen('universes');
        } catch {
            elements.universeError.textContent = 'Could not reach server.';
            showScreen('universes');
        }
    }

    function selectUniverse(u: UniverseInfo) {
        if (u.playerId) {
            onStart(u.id);
        } else {
            selectedUniverse = u;
            elements.playerNameInput.value = '';
            elements.playerNameError.textContent = '';
            showScreen('playerName');
        }
    }

    async function joinUniverse() {
        if (!selectedUniverse) return;
        const name = elements.playerNameInput.value.trim();
        if (!name) {
            elements.playerNameError.textContent = 'Name is required.';
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
                elements.playerNameError.textContent = data.error || 'Failed to join.';
                return;
            }
            onStart(selectedUniverse.id);
        } catch {
            elements.playerNameError.textContent = 'Could not reach server.';
        }
    }

    elements.playerNameSubmit.addEventListener('click', joinUniverse);
    elements.playerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinUniverse();
    });

    return { showUniverseSelect };
}
