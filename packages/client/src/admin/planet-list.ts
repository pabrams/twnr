import { listPlanets, deletePlanet } from './api-planets.js';
import type { PlanetConfig } from './api-planets.js';
import { renderPlanetEditor } from './planet-editor.js';

export function renderPlanetList(container: HTMLElement): void {
    container.innerHTML = '';

    const heading = document.createElement('h3');
    heading.textContent = 'Planet Specs';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '8px';
    container.appendChild(heading);

    const createBtn = document.createElement('button');
    createBtn.textContent = '+ New Planet';
    Object.assign(createBtn.style, {
        background: '#333',
        color: '#c0c0c0',
        border: '1px solid #555',
        padding: '6px 14px',
        fontFamily: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
        marginBottom: '10px',
    });
    createBtn.addEventListener('mouseenter', () => {
        createBtn.style.background = '#444';
    });
    createBtn.addEventListener('mouseleave', () => {
        createBtn.style.background = '#333';
    });
    createBtn.addEventListener('click', () => {
        renderPlanetEditor(
            container,
            null,
            () => renderPlanetList(container),
            () => renderPlanetList(container),
        );
    });
    container.appendChild(createBtn);

    const tableContainer = document.createElement('div');
    container.appendChild(tableContainer);

    const loading = document.createElement('div');
    loading.textContent = 'Loading planets...';
    loading.style.color = '#888';
    tableContainer.appendChild(loading);

    listPlanets()
        .then((planets: PlanetConfig[]) => {
            tableContainer.innerHTML = '';

            if (planets.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'No planet types configured.';
                empty.style.color = '#888';
                tableContainer.appendChild(empty);
                return;
            }

            const table = document.createElement('table');
            table.style.borderCollapse = 'collapse';
            table.style.fontFamily = "'Courier New', Courier, monospace";
            table.style.fontSize = '12px';
            table.style.width = '100%';

            // Header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            const headers = [
                'Type',
                'Description',
                'Colonists',
                'Citadel',
                'Fuel',
                'Org',
                'Equip',
                'Actions',
            ];
            for (const h of headers) {
                const th = document.createElement('th');
                th.textContent = h;
                Object.assign(th.style, {
                    textAlign: 'left',
                    padding: '4px 8px',
                    color: '#888',
                    borderBottom: '1px solid #444',
                });
                headerRow.appendChild(th);
            }
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            for (const planet of planets) {
                const tr = document.createElement('tr');

                // Truncate description to 30 chars
                const desc =
                    planet.description.length > 30
                        ? planet.description.slice(0, 27) + '...'
                        : planet.description;

                const cells = [
                    String(planet.type),
                    desc,
                    String(planet.maxColonists),
                    String(planet.maxCitadel),
                    String(planet.fuelProduction),
                    String(planet.organicsProduction),
                    String(planet.equipmentProduction),
                ];
                for (const val of cells) {
                    const td = document.createElement('td');
                    td.textContent = val;
                    td.style.padding = '3px 8px';
                    td.style.borderBottom = '1px solid #222';
                    tr.appendChild(td);
                }

                // Actions
                const actionTd = document.createElement('td');
                actionTd.style.padding = '3px 8px';
                actionTd.style.borderBottom = '1px solid #222';

                const editBtn = document.createElement('button');
                editBtn.textContent = 'Edit';
                Object.assign(editBtn.style, {
                    background: '#333',
                    color: '#c0c0c0',
                    border: '1px solid #555',
                    padding: '2px 8px',
                    fontFamily: 'inherit',
                    fontSize: '11px',
                    cursor: 'pointer',
                    marginRight: '4px',
                });
                editBtn.addEventListener('click', () => {
                    renderPlanetEditor(
                        container,
                        planet,
                        () => renderPlanetList(container),
                        () => renderPlanetList(container),
                    );
                });

                const delBtn = document.createElement('button');
                delBtn.textContent = 'Del';
                Object.assign(delBtn.style, {
                    background: '#333',
                    color: '#c0c0c0',
                    border: '1px solid #555',
                    padding: '2px 8px',
                    fontFamily: 'inherit',
                    fontSize: '11px',
                    cursor: 'pointer',
                });
                delBtn.addEventListener('click', () => {
                    if (confirm(`Delete planet type "${planet.type}"?`)) {
                        deletePlanet(planet.type)
                            .then(() => renderPlanetList(container))
                            .catch((err: Error) => alert(err.message));
                    }
                });

                actionTd.appendChild(editBtn);
                actionTd.appendChild(delBtn);
                tr.appendChild(actionTd);

                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            tableContainer.appendChild(table);
        })
        .catch((err: Error) => {
            loading.textContent = err.message || 'Failed to load planets.';
            loading.style.color = '#f44';
        });
}
