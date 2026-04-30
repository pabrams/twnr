import { listShips, deleteShip } from './api-ships.js';
import type { ShipConfig } from './api-ships.js';
import { renderShipEditor } from './ship-editor.js';

export function renderShipList(container: HTMLElement): void {
    container.innerHTML = '';

    const heading = document.createElement('h3');
    heading.textContent = 'Ship Catalog';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '8px';
    container.appendChild(heading);

    const createBtn = document.createElement('button');
    createBtn.textContent = '+ New Ship';
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
        renderShipEditor({
            container,
            existing: null,
            onSave: () => renderShipList(container),
            onCancel: () => renderShipList(container),
        });
    });
    container.appendChild(createBtn);

    const tableContainer = document.createElement('div');
    container.appendChild(tableContainer);

    const loading = document.createElement('div');
    loading.textContent = 'Loading ships...';
    loading.style.color = '#888';
    tableContainer.appendChild(loading);

    listShips()
        .then((ships: ShipConfig[]) => {
            tableContainer.innerHTML = '';

            if (ships.length === 0) {
                const empty = document.createElement('div');
                empty.textContent = 'No ships configured.';
                empty.style.color = '#888';
                tableContainer.appendChild(empty);
                return;
            }

            const table = document.createElement('table');
            table.style.borderCollapse = 'collapse';
            table.style.fontFamily = "'Courier New', Courier, monospace";
            table.style.fontSize = '12px';
            table.style.width = '100%';

            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            const headers = [
                'Name',
                'Price',
                'Drones',
                'Shields',
                'Start Holds',
                'Max Holds',
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
            for (const ship of ships) {
                const tr = document.createElement('tr');

                const cells = [
                    String(ship.name),
                    String(ship.price),
                    String(ship.maxDrones),
                    String(ship.maxShields),
                    String(ship.startingHolds),
                    String(ship.maxHolds),
                ];
                for (const val of cells) {
                    const td = document.createElement('td');
                    td.textContent = val;
                    td.style.padding = '3px 8px';
                    td.style.borderBottom = '1px solid #222';
                    tr.appendChild(td);
                }

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
                    renderShipEditor({
                        container,
                        existing: ship,
                        onSave: () => renderShipList(container),
                        onCancel: () => renderShipList(container),
                    });
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
                    if (confirm(`Delete ship "${ship.name}"?`)) {
                        deleteShip(ship.name)
                            .then(() => renderShipList(container))
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
            loading.textContent = err.message || 'Failed to load ships.';
            loading.style.color = '#f44';
        });
}
