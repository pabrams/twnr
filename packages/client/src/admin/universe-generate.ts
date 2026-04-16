import { generateUniverse } from './api.js';

const DEFAULT_WARP_DIST = [12, 18, 20, 20, 15, 15];

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

function makeWarpDistField(): {
    row: HTMLElement;
    inputs: HTMLInputElement[];
    getValues: () => number[] | null;
    errorSpan: HTMLSpanElement;
} {
    const row = document.createElement('div');
    row.style.marginBottom = '8px';

    const lbl = document.createElement('label');
    lbl.textContent = 'Warp-Out Distribution (degrees 1-6, must sum to 100)';
    lbl.style.display = 'block';
    lbl.style.color = '#888';
    lbl.style.fontSize = '12px';
    lbl.style.marginBottom = '2px';
    row.appendChild(lbl);

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(6, 1fr)';
    grid.style.gap = '4px';
    grid.style.maxWidth = '280px';
    row.appendChild(grid);

    const inputs: HTMLInputElement[] = [];
    for (let d = 1; d <= 6; d++) {
        const cell = document.createElement('div');
        cell.style.textAlign = 'center';

        const header = document.createElement('div');
        header.textContent = `${d}`;
        header.style.color = '#666';
        header.style.fontSize = '11px';
        cell.appendChild(header);

        const input = document.createElement('input');
        Object.assign(input.style, {
            background: '#111',
            color: '#c0c0c0',
            border: '1px solid #444',
            padding: '4px 2px',
            fontFamily: 'inherit',
            fontSize: '13px',
            width: '100%',
            textAlign: 'center',
            boxSizing: 'border-box',
        });
        input.type = 'number';
        input.min = '0';
        input.max = '100';
        input.value = String(DEFAULT_WARP_DIST[d - 1]);
        cell.appendChild(input);

        grid.appendChild(cell);
        inputs.push(input);
    }

    const errorSpan = document.createElement('span');
    errorSpan.style.color = '#f44';
    errorSpan.style.fontSize = '11px';
    row.appendChild(errorSpan);

    // Live sum validation
    function updateSum() {
        const vals = inputs.map((inp) => parseFloat(inp.value) || 0);
        const sum = vals.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 0.01) {
            errorSpan.textContent = ` Sum: ${sum} (must be 100)`;
        } else {
            errorSpan.textContent = '';
        }
    }
    for (const inp of inputs) {
        inp.addEventListener('input', updateSum);
    }

    function getValues(): number[] | null {
        const vals = inputs.map((inp) => parseFloat(inp.value) || 0);
        const sum = vals.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 100) > 0.01) return null;
        if (vals.some((v) => v < 0)) return null;
        return vals;
    }

    return { row, inputs, getValues, errorSpan };
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

    const sectorsField = makeInput('Sectors (20-25000)', {
        type: 'number',
        placeholder: '5000',
        min: '20',
        max: '25000',
    });
    sectorsField.input.value = '5000';
    form.appendChild(sectorsField.row);

    const seedField = makeInput('Seed (optional)', { type: 'number', placeholder: 'Random' });
    form.appendChild(seedField.row);

    const portDensityField = makeInput('Port Density % (0-100)', {
        type: 'number',
        placeholder: '80',
        min: '0',
        max: '100',
    });
    portDensityField.input.value = '80';
    form.appendChild(portDensityField.row);

    const twoWayField = makeInput('Two-Way Warp % (0-100)', {
        type: 'number',
        placeholder: '95',
        min: '0',
        max: '100',
    });
    twoWayField.input.value = '95';
    form.appendChild(twoWayField.row);

    const warpDistField = makeWarpDistField();
    form.appendChild(warpDistField.row);

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

        const sectors = parseInt(sectorsField.input.value, 10) || 5000;
        const seedVal = seedField.input.value.trim();
        const seed = seedVal ? parseInt(seedVal, 10) : undefined;
        const portDensity = parseInt(portDensityField.input.value, 10);
        const twoWayPct = parseInt(twoWayField.input.value, 10);
        const warpDist = warpDistField.getValues();

        if (!warpDist) {
            errorDiv.textContent = 'Warp distribution values must sum to 100.';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Generating...';

        generateUniverse({
            name,
            sectors,
            seed,
            portDensity: isNaN(portDensity) ? undefined : portDensity,
            twoWayPct: isNaN(twoWayPct) ? undefined : twoWayPct,
            warpDist,
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
