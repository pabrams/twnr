export interface UniverseInfo {
    id: number;
    name: string;
    playerId: number | null;
    playerName: string | null;
}

export function setupUniverseScreen(opts: {
    elements: {
        universeList: HTMLElement;
        universeError: HTMLElement;
        playerNameDiv: HTMLElement;
        playerNameInput: HTMLInputElement;
        playerNameError: HTMLElement;
        playerNameSubmit: HTMLButtonElement;
    };
    showScreen: (screen: 'auth' | 'universes' | 'playerName' | 'game' | 'admin') => void;
    onStart: (universeId: number) => void;
    /** Invoked when /api/universes rejects auth (401/403): the JWT cookie is
     * stale (expired, revoked, or pointing at a deleted guest). The handler
     * is expected to clear server-side session state and route the user to
     * the auth screen. */
    onUnauthorized: () => void;
}) {
    const { elements, showScreen, onStart, onUnauthorized } = opts;
    let selectedUniverse: UniverseInfo | null = null;

    async function showUniverseSelect() {
        elements.universeError.textContent = '';
        elements.universeList.innerHTML = '';

        try {
            const res = await fetch('/api/universes');
            if (res.status === 401 || res.status === 403) {
                onUnauthorized();
                return;
            }
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
