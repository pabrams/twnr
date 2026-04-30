import { createPlanet, updatePlanet } from './api-planets.js';
import type { PlanetConfig } from './api-planets.js';

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

export function renderPlanetEditor(opts: {
    container: HTMLElement;
    existing: PlanetConfig | null;
    onSave: () => void;
    onCancel: () => void;
}): void {
    const { container, existing, onSave, onCancel } = opts;
    container.innerHTML = '';

    const heading = document.createElement('h3');
    heading.textContent = existing ? `Edit: ${existing.type}` : 'New Planet Type';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '10px';
    container.appendChild(heading);

    const form = document.createElement('div');
    container.appendChild(form);

    const typeField = makeField('Type', { type: 'text' }, existing?.type ?? '');
    if (existing) typeField.input.disabled = true;
    form.appendChild(typeField.row);

    const descField = makeField('Description', { type: 'text' }, existing?.description ?? '');
    descField.input.style.width = '240px';
    form.appendChild(descField.row);

    const colonistsField = makeField(
        'Max Colonists',
        { type: 'number', min: '0' },
        String(existing?.maxColonists ?? 0),
    );
    form.appendChild(colonistsField.row);

    const citadelField = makeField(
        'Max Citadel',
        { type: 'number', min: '0' },
        String(existing?.maxCitadel ?? 0),
    );
    form.appendChild(citadelField.row);

    const fuelField = makeField(
        'Fuel Prod',
        { type: 'number', min: '0' },
        String(existing?.fuelProduction ?? 0),
    );
    form.appendChild(fuelField.row);

    const orgField = makeField(
        'Org Prod',
        { type: 'number', min: '0' },
        String(existing?.organicsProduction ?? 0),
    );
    form.appendChild(orgField.row);

    const equipField = makeField(
        'Equip Prod',
        { type: 'number', min: '0' },
        String(existing?.equipmentProduction ?? 0),
    );
    form.appendChild(equipField.row);

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

        const type = typeField.input.value.trim();
        if (!type) {
            errorDiv.textContent = 'Type is required.';
            return;
        }

        const planet: PlanetConfig = {
            type,
            description: descField.input.value,
            maxColonists: parseInt(colonistsField.input.value, 10),
            maxCitadel: parseInt(citadelField.input.value, 10),
            fuelProduction: parseInt(fuelField.input.value, 10),
            organicsProduction: parseInt(orgField.input.value, 10),
            equipmentProduction: parseInt(equipField.input.value, 10),
        };

        saveBtn.disabled = true;

        if (existing) {
            updatePlanet(existing.type, planet)
                .then(() => onSave())
                .catch((err: Error) => {
                    errorDiv.textContent = err.message || 'Update failed.';
                })
                .finally(() => {
                    saveBtn.disabled = false;
                });
        } else {
            createPlanet(planet)
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
