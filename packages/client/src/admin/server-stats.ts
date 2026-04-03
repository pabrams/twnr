import { getServerStats } from './api.js';

export function renderServerStats(container: HTMLElement): void {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Server Stats';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '12px';
    container.appendChild(heading);

    const loading = document.createElement('div');
    loading.textContent = 'Loading...';
    loading.style.color = '#888';
    container.appendChild(loading);

    getServerStats()
        .then((stats) => {
            loading.remove();

            const table = document.createElement('table');
            table.style.borderCollapse = 'collapse';
            table.style.fontFamily = "'Courier New', Courier, monospace";

            const rows: [string, string][] = [
                ['Uptime', formatUptime(stats.uptime)],
                ['Players Online', String(stats.playersOnline)],
                ['Total Players', String(stats.totalPlayers)],
                ['Total Sectors', String(stats.totalSectors)],
                ['Node Version', stats.nodeVersion],
                ['Platform', stats.platform],
            ];

            for (const [label, value] of rows) {
                const tr = document.createElement('tr');

                const td1 = document.createElement('td');
                td1.textContent = label;
                td1.style.padding = '4px 16px 4px 0';
                td1.style.color = '#888';
                tr.appendChild(td1);

                const td2 = document.createElement('td');
                td2.textContent = value;
                td2.style.padding = '4px 0';
                td2.style.color = '#c0c0c0';
                tr.appendChild(td2);

                table.appendChild(tr);
            }

            container.appendChild(table);

            const refreshBtn = document.createElement('button');
            refreshBtn.textContent = 'Refresh';
            Object.assign(refreshBtn.style, {
                marginTop: '16px',
                background: '#333',
                color: '#c0c0c0',
                border: '1px solid #555',
                padding: '6px 16px',
                fontFamily: 'inherit',
                fontSize: '14px',
                cursor: 'pointer',
            });
            refreshBtn.addEventListener('click', () => renderServerStats(container));
            refreshBtn.addEventListener('mouseenter', () => {
                refreshBtn.style.background = '#444';
            });
            refreshBtn.addEventListener('mouseleave', () => {
                refreshBtn.style.background = '#333';
            });
            container.appendChild(refreshBtn);
        })
        .catch((err: Error) => {
            loading.textContent = err.message || 'Failed to load server stats.';
            loading.style.color = '#f44';
        });
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}
