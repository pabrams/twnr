import { getUniverseStats, deleteUniverse, renameUniverse, cloneUniverse } from './api.js';
import type { UniverseStats } from './api.js';

interface UniverseBasic {
    id: number;
    name: string;
}

function makeButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
        background: '#333',
        color: '#c0c0c0',
        border: '1px solid #555',
        padding: '4px 10px',
        fontFamily: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
        marginLeft: '6px',
    });
    btn.addEventListener('mouseenter', () => {
        btn.style.background = '#444';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.background = '#333';
    });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

export function renderUniverseList(
    container: HTMLElement,
    onSelectUniverse: (id: number) => void,
    onRefresh: () => void,
): void {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Universes';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '12px';
    container.appendChild(heading);

    const loading = document.createElement('div');
    loading.textContent = 'Loading...';
    loading.style.color = '#888';
    container.appendChild(loading);

    fetch('/api/universes')
        .then((res) => {
            if (!res.ok) throw new Error('Failed to load universes.');
            return res.json() as Promise<UniverseBasic[]>;
        })
        .then(async (universes) => {
            loading.remove();

            if (universes.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'No universes found.';
                empty.style.color = '#888';
                container.appendChild(empty);
                return;
            }

            const list = document.createElement('div');
            container.appendChild(list);

            const statsResults = await Promise.allSettled(
                universes.map((u) => getUniverseStats(u.id)),
            );

            for (let i = 0; i < universes.length; i++) {
                const u = universes[i];
                const statsResult = statsResults[i];
                const stats: UniverseStats | null =
                    statsResult.status === 'fulfilled' ? statsResult.value : null;

                const row = document.createElement('div');
                Object.assign(row.style, {
                    background: '#111',
                    border: '1px solid #444',
                    padding: '10px 14px',
                    marginBottom: '6px',
                    cursor: 'pointer',
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: '14px',
                });
                row.addEventListener('mouseenter', () => {
                    row.style.background = '#222';
                    row.style.borderColor = '#666';
                });
                row.addEventListener('mouseleave', () => {
                    row.style.background = '#111';
                    row.style.borderColor = '#444';
                });

                const nameRow = document.createElement('div');
                nameRow.style.display = 'flex';
                nameRow.style.justifyContent = 'space-between';
                nameRow.style.alignItems = 'center';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = u.name;
                nameSpan.style.color = '#0ff';
                nameSpan.style.cursor = 'pointer';
                nameSpan.addEventListener('click', () => onSelectUniverse(u.id));
                nameRow.appendChild(nameSpan);

                const btnGroup = document.createElement('span');
                btnGroup.appendChild(makeButton('Details', () => onSelectUniverse(u.id)));
                btnGroup.appendChild(
                    makeButton('Rename', () => {
                        const newName = prompt('New name:', u.name);
                        if (newName && newName !== u.name) {
                            renameUniverse(u.id, newName)
                                .then(() => onRefresh())
                                .catch((err: Error) => alert(err.message));
                        }
                    }),
                );
                btnGroup.appendChild(
                    makeButton('Clone', () => {
                        const cloneName = prompt('Name for clone:', u.name + ' (copy)');
                        if (cloneName) {
                            cloneUniverse(u.id, cloneName)
                                .then(() => onRefresh())
                                .catch((err: Error) => alert(err.message));
                        }
                    }),
                );
                btnGroup.appendChild(
                    makeButton('Delete', () => {
                        if (confirm(`Delete universe "${u.name}"? This cannot be undone.`)) {
                            deleteUniverse(u.id)
                                .then(() => onRefresh())
                                .catch((err: Error) => alert(err.message));
                        }
                    }),
                );
                nameRow.appendChild(btnGroup);
                row.appendChild(nameRow);

                if (stats) {
                    const info = document.createElement('div');
                    info.style.color = '#888';
                    info.style.fontSize = '12px';
                    info.style.marginTop = '4px';
                    info.textContent = `Sectors: ${stats.sectorCount}  Warps: ${stats.warpCount}  Ports: ${stats.portCount}  Players: ${stats.playerCount}`;
                    row.appendChild(info);
                }

                list.appendChild(row);
            }
        })
        .catch((err: Error) => {
            loading.textContent = err.message || 'Failed to load universes.';
            loading.style.color = '#f44';
        });
}
