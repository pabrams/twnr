import { renderServerStats } from '../admin/server-stats.js';
import { renderUniverseList } from '../admin/universe-list.js';
import { renderUniverseGenerator } from '../admin/universe-generate.js';
import { renderUniverseDetail } from '../admin/universe-detail.js';

type Tab = 'dashboard' | 'universes' | 'generate';

export function setupAdminScreen(container: HTMLElement, onBack: () => void): void {
    container.innerHTML = '';

    // Nav bar
    const nav = document.createElement('div');
    Object.assign(nav.style, {
        display: 'flex',
        gap: '0',
        borderBottom: '1px solid #444',
        marginBottom: '16px',
        flexWrap: 'wrap',
    });

    const tabs: { id: Tab; label: string }[] = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'universes', label: 'Universes' },
        { id: 'generate', label: 'Generate' },
    ];

    const tabButtons: Map<Tab, HTMLButtonElement> = new Map();

    function styleTab(btn: HTMLButtonElement, active: boolean) {
        Object.assign(btn.style, {
            background: active ? '#222' : 'transparent',
            color: active ? '#0ff' : '#888',
            border: 'none',
            borderBottom: active ? '2px solid #0ff' : '2px solid transparent',
            padding: '8px 16px',
            fontFamily: 'inherit',
            fontSize: '14px',
            cursor: 'pointer',
        });
    }

    // Content area
    const content = document.createElement('div');
    content.style.padding = '0 4px';

    let activeTab: Tab = 'dashboard';

    function switchTab(tab: Tab) {
        activeTab = tab;
        for (const [id, btn] of tabButtons) {
            styleTab(btn, id === tab);
        }
        switch (tab) {
            case 'dashboard':
                renderServerStats(content);
                break;
            case 'universes':
                renderUniverseListView();
                break;
            case 'generate':
                renderUniverseGenerator(content, () => {
                    // After generating, switch to universes tab
                });
                break;
        }
    }

    function renderUniverseListView() {
        renderUniverseList(
            content,
            (id) => renderUniverseDetail(content, id, () => renderUniverseListView()),
            () => renderUniverseListView(),
        );
    }

    for (const tab of tabs) {
        const btn = document.createElement('button');
        btn.textContent = tab.label;
        styleTab(btn, tab.id === 'dashboard');
        btn.addEventListener('mouseenter', () => {
            if (tab.id !== activeTab) btn.style.color = '#c0c0c0';
        });
        btn.addEventListener('mouseleave', () => {
            if (tab.id !== activeTab) btn.style.color = '#888';
        });
        btn.addEventListener('click', () => switchTab(tab.id));
        tabButtons.set(tab.id, btn);
        nav.appendChild(btn);
    }

    // Back button (right-aligned)
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    nav.appendChild(spacer);

    const backBtn = document.createElement('button');
    backBtn.textContent = '\u2190 Back';
    Object.assign(backBtn.style, {
        background: 'transparent',
        color: '#888',
        border: 'none',
        padding: '8px 16px',
        fontFamily: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
    });
    backBtn.addEventListener('mouseenter', () => {
        backBtn.style.color = '#c0c0c0';
    });
    backBtn.addEventListener('mouseleave', () => {
        backBtn.style.color = '#888';
    });
    backBtn.addEventListener('click', onBack);
    nav.appendChild(backBtn);

    container.appendChild(nav);
    container.appendChild(content);

    // Default to dashboard
    switchTab('dashboard');
}
