import { generateUniverse } from './api.js';

function makeInput(
    label: string,
    attrs: Record<string, string>,
): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.style.marginBottom = '8px';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.display = 'block';
    lbl.style.color = '#888';
    lbl.style.fontSize = '12px';
    lbl.style.marginBottom = '2px';
    row.appendChild(lbl);

    const input = document.createElement('input');
    Object.assign(input.style, {
        background: '#111',
        color: '#c0c0c0',
        border: '1px solid #444',
        padding: '6px 10px',
        fontFamily: 'inherit',
        fontSize: '14px',
        width: '260px',
    });
    for (const [k, v] of Object.entries(attrs)) {
        input.setAttribute(k, v);
    }
    row.appendChild(input);

    return { row, input };
}

export function renderUniverseGenerator(container: HTMLElement, onGenerated: () => void): void {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Generate Universe';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '12px';
    container.appendChild(heading);

    const form = document.createElement('div');
    container.appendChild(form);

    const nameField = makeInput('Name (required)', { type: 'text', placeholder: 'Universe name' });
    form.appendChild(nameField.row);

    const sectorsField = makeInput('Sectors (20-500)', {
        type: 'number',
        placeholder: '100',
        min: '20',
        max: '500',
    });
    sectorsField.input.value = '100';
    form.appendChild(sectorsField.row);

    const seedField = makeInput('Seed (optional)', { type: 'number', placeholder: 'Random' });
    form.appendChild(seedField.row);

    const portDensityField = makeInput('Port Density % (0-100)', {
        type: 'number',
        placeholder: '50',
        min: '0',
        max: '100',
    });
    portDensityField.input.value = '50';
    form.appendChild(portDensityField.row);

    const twoWayField = makeInput('Two-Way Warp % (0-100)', {
        type: 'number',
        placeholder: '90',
        min: '0',
        max: '100',
    });
    twoWayField.input.value = '90';
    form.appendChild(twoWayField.row);

    const errorDiv = document.createElement('div');
    errorDiv.style.color = '#f44';
    errorDiv.style.fontSize = '13px';
    errorDiv.style.minHeight = '1em';
    errorDiv.style.marginTop = '8px';
    form.appendChild(errorDiv);

    const resultDiv = document.createElement('div');
    resultDiv.style.marginTop = '8px';
    form.appendChild(resultDiv);

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Generate';
    Object.assign(submitBtn.style, {
        marginTop: '12px',
        background: '#333',
        color: '#c0c0c0',
        border: '1px solid #555',
        padding: '8px 16px',
        fontFamily: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
        width: '260px',
    });
    submitBtn.addEventListener('mouseenter', () => {
        submitBtn.style.background = '#444';
    });
    submitBtn.addEventListener('mouseleave', () => {
        submitBtn.style.background = '#333';
    });
    form.appendChild(submitBtn);

    submitBtn.addEventListener('click', () => {
        errorDiv.textContent = '';
        resultDiv.innerHTML = '';

        const name = nameField.input.value.trim();
        if (!name) {
            errorDiv.textContent = 'Name is required.';
            return;
        }

        const sectors = parseInt(sectorsField.input.value, 10) || 100;
        const seedVal = seedField.input.value.trim();
        const seed = seedVal ? parseInt(seedVal, 10) : undefined;
        const portDensity = parseInt(portDensityField.input.value, 10);
        const twoWayPct = parseInt(twoWayField.input.value, 10);

        submitBtn.disabled = true;
        submitBtn.textContent = 'Generating...';

        generateUniverse({
            name,
            sectors,
            seed,
            portDensity: isNaN(portDensity) ? undefined : portDensity,
            twoWayPct: isNaN(twoWayPct) ? undefined : twoWayPct,
        })
            .then((result) => {
                resultDiv.style.color = '#0ff';
                resultDiv.textContent = `Created "${result.name}" (id: ${result.id}) — ${result.sectorCount} sectors, ${result.warpCount} warps, ${result.portCount} ports, seed: ${result.seed}`;
                onGenerated();
            })
            .catch((err: Error) => {
                errorDiv.textContent = err.message || 'Generation failed.';
            })
            .finally(() => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Generate';
            });
    });
}
