import { getUniverseStats, getUniverseTopology } from './api.js';
import { renderPortList } from './port-list.js';

export function renderUniverseDetail(
    container: HTMLElement,
    universeId: number,
    onBack: () => void,
): void {
    container.innerHTML = '';

    const backBtn = document.createElement('button');
    backBtn.textContent = '\u2190 Back to list';
    Object.assign(backBtn.style, {
        background: 'none',
        color: '#888',
        border: 'none',
        padding: '4px 0',
        fontFamily: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
        marginBottom: '12px',
    });
    backBtn.addEventListener('mouseenter', () => {
        backBtn.style.color = '#c0c0c0';
    });
    backBtn.addEventListener('mouseleave', () => {
        backBtn.style.color = '#888';
    });
    backBtn.addEventListener('click', onBack);
    container.appendChild(backBtn);

    const heading = document.createElement('h2');
    heading.textContent = 'Universe Details';
    heading.style.color = '#0ff';
    heading.style.marginBottom = '12px';
    container.appendChild(heading);

    const loading = document.createElement('div');
    loading.textContent = 'Loading...';
    loading.style.color = '#888';
    container.appendChild(loading);

    Promise.all([getUniverseStats(universeId), getUniverseTopology(universeId)])
        .then(([stats, topo]) => {
            loading.remove();

            const statsSection = document.createElement('div');
            statsSection.style.marginBottom = '20px';

            heading.textContent = stats.name;

            const statsTable = document.createElement('table');
            statsTable.style.borderCollapse = 'collapse';
            statsTable.style.fontFamily = "'Courier New', Courier, monospace";

            const statsRows: [string, string][] = [
                ['ID', String(stats.id)],
                ['Seed', String(stats.seed)],
                ['Created', new Date(stats.createdAt).toLocaleString()],
                ['Sectors', String(stats.sectorCount)],
                ['Warps', String(stats.warpCount)],
                ['Ports', String(stats.portCount)],
                ['Players', String(stats.playerCount)],
            ];

            for (const [label, value] of statsRows) {
                const tr = document.createElement('tr');
                const td1 = document.createElement('td');
                td1.textContent = label;
                td1.style.padding = '3px 16px 3px 0';
                td1.style.color = '#888';
                tr.appendChild(td1);
                const td2 = document.createElement('td');
                td2.textContent = value;
                td2.style.padding = '3px 0';
                tr.appendChild(td2);
                statsTable.appendChild(tr);
            }
            statsSection.appendChild(statsTable);
            container.appendChild(statsSection);

            const topoHeading = document.createElement('h3');
            topoHeading.textContent = 'Topology';
            topoHeading.style.color = '#0ff';
            topoHeading.style.marginBottom = '8px';
            container.appendChild(topoHeading);

            const topoTable = document.createElement('table');
            topoTable.style.borderCollapse = 'collapse';
            topoTable.style.fontFamily = "'Courier New', Courier, monospace";
            topoTable.style.marginBottom = '20px';

            const topoRows: [string, string][] = [
                ['Total Warps', String(topo.totalWarps)],
                ['Bidirectional Pairs', String(topo.bidirectionalPairs)],
                ['Avg Out-Degree', topo.averageOutDegree.toFixed(2)],
                [
                    'Dead-End Sectors',
                    topo.deadEndSectors.length > 0 ? topo.deadEndSectors.join(', ') : 'None',
                ],
                ['Connected', topo.isConnected ? 'Yes' : 'No'],
            ];

            for (const [label, value] of topoRows) {
                const tr = document.createElement('tr');
                const td1 = document.createElement('td');
                td1.textContent = label;
                td1.style.padding = '3px 16px 3px 0';
                td1.style.color = '#888';
                tr.appendChild(td1);
                const td2 = document.createElement('td');
                td2.textContent = value;
                td2.style.padding = '3px 0';
                td2.style.color = value === 'No' ? '#f44' : '#c0c0c0';
                tr.appendChild(td2);
                topoTable.appendChild(tr);
            }
            container.appendChild(topoTable);

            const portSection = document.createElement('div');
            container.appendChild(portSection);
            renderPortList(portSection, universeId);
        })
        .catch((err: Error) => {
            loading.textContent = err.message || 'Failed to load universe details.';
            loading.style.color = '#f44';
        });
}
