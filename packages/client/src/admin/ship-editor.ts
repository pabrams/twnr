import { createShip, updateShip } from './api-ships.js';
import type { ShipConfig } from './api-ships.js';

function makeField(
    label: string,
    attrs: Record<string, string>,
    value?: string,
): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.style.marginBottom = '6px';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.color = '#888';
    lbl.style.fontSize = '12px';
    lbl.style.width = '100px';
    lbl.style.textAlign = 'right';
    row.appendChild(lbl);

    const input = document.createElement('input');
    Object.assign(input.style, {
        background: '#111',
        color: '#c0c0c0',
        border: '1px solid #444',
        padding: '4px 8px',
        fontFamily: 'inherit',
        fontSize: '13px',
        width: '120px',
    });
    for (const [k, v] of Object.entries(attrs)) {
        input.setAttribute(k, v);
    }
    if (value !== undefined) input.value = value;
    row.appendChild(input);

    return { row, input };
}

export function renderShipEditor(
    container: HTMLElement,
    existing: ShipConfig | null,
    onSave: () => void,
    onCancel: () => void,
): void {
    container.innerHTML = '';

    const heading = document.createElement('h3');
    heading.textContent = existing ? `Edit: ${existing.name}` : 'New Ship';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '10px';
    container.appendChild(heading);

    const form = document.createElement('div');
    container.appendChild(form);

    const nameField = makeField('Name', { type: 'text' }, existing?.name ?? '');
    if (existing) nameField.input.disabled = true;
    form.appendChild(nameField.row);

    const priceField = makeField(
        'Price',
        { type: 'number', min: '0' },
        String(existing?.price ?? 0),
    );
    form.appendChild(priceField.row);

    const fightersField = makeField(
        'Max Fighters',
        { type: 'number', min: '0' },
        String(existing?.maxFighters ?? 0),
    );
    form.appendChild(fightersField.row);

    const shieldsField = makeField(
        'Max Shields',
        { type: 'number', min: '0' },
        String(existing?.maxShields ?? 0),
    );
    form.appendChild(shieldsField.row);

    const startHoldsField = makeField(
        'Starting Holds',
        { type: 'number', min: '0' },
        String(existing?.startingHolds ?? 0),
    );
    form.appendChild(startHoldsField.row);

    const maxHoldsField = makeField(
        'Max Holds',
        { type: 'number', min: '0' },
        String(existing?.maxHolds ?? 0),
    );
    form.appendChild(maxHoldsField.row);

    const errorDiv = document.createElement('div');
    errorDiv.style.color = '#f44';
    errorDiv.style.fontSize = '13px';
    errorDiv.style.minHeight = '1em';
    errorDiv.style.marginTop = '8px';
    form.appendChild(errorDiv);

    const btnRow = document.createElement('div');
    btnRow.style.marginTop = '10px';
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = existing ? 'Save' : 'Create';
    Object.assign(saveBtn.style, {
        background: '#333',
        color: '#c0c0c0',
        border: '1px solid #555',
        padding: '6px 16px',
        fontFamily: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
    });
    saveBtn.addEventListener('mouseenter', () => {
        saveBtn.style.background = '#444';
    });
    saveBtn.addEventListener('mouseleave', () => {
        saveBtn.style.background = '#333';
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
        background: '#222',
        color: '#888',
        border: '1px solid #444',
        padding: '6px 16px',
        fontFamily: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
    });
    cancelBtn.addEventListener('mouseenter', () => {
        cancelBtn.style.background = '#333';
    });
    cancelBtn.addEventListener('mouseleave', () => {
        cancelBtn.style.background = '#222';
    });
    cancelBtn.addEventListener('click', onCancel);

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    form.appendChild(btnRow);

    saveBtn.addEventListener('click', () => {
        errorDiv.textContent = '';

        const name = nameField.input.value.trim();
        if (!name) {
            errorDiv.textContent = 'Name is required.';
            return;
        }

        const ship: ShipConfig = {
            name,
            price: parseInt(priceField.input.value, 10),
            maxFighters: parseInt(fightersField.input.value, 10),
            maxShields: parseInt(shieldsField.input.value, 10),
            startingHolds: parseInt(startHoldsField.input.value, 10),
            maxHolds: parseInt(maxHoldsField.input.value, 10),
        };

        saveBtn.disabled = true;

        if (existing) {
            updateShip(existing.name, ship)
                .then(() => onSave())
                .catch((err: Error) => {
                    errorDiv.textContent = err.message || 'Update failed.';
                })
                .finally(() => {
                    saveBtn.disabled = false;
                });
        } else {
            createShip(ship)
                .then(() => onSave())
                .catch((err: Error) => {
                    errorDiv.textContent = err.message || 'Create failed.';
                })
                .finally(() => {
                    saveBtn.disabled = false;
                });
        }
    });
}
