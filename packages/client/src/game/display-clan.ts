import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { CLAN, COMMON } from './messages/index.js';

export type DisplayClanCtx = Pick<GameContext, 'io' | 'world'>;

export function showClanPrompt(ctx: DisplayClanCtx) {
    ctx.io.term.write(render(CLAN.prompt, { sector: ctx.world.currentSector }));
}

export function showClanHelp(ctx: DisplayClanCtx) {
    const t = ctx.io.term;
    t.writeln('');
    t.writeln(render('[mg]   Clan Commands[/mg]'));
    t.writeln(
        render('[by]   =[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]='),
    );
    t.writeln(render(COMMON.menuRow, { key: 'D', text: '[bc]Display Clans[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'I', text: '[bc]Your Clan Info[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'M', text: '[bc]Make a New Clan[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'J', text: '[bc]Join a Clan[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'X', text: '[bc]Leave Your Clan[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'C', text: '[bc]Credit Transfer[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'F', text: '[bc]Drone (Fighter) Transfer[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'H', text: '[bc]Mine Transfer[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'S', text: '[bc]Shield Transfer[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'T', text: '[bc]Send Clan Memo[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'P', text: '[bc]Clan Security (leader)[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'R', text: '[bc]Drop Member (leader)[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'L', text: '[bc]Clanmate Locations[/bc]' }));
    t.writeln(render(COMMON.menuRow, { key: 'Q', text: '[bc]Exit Clan Menu[/bc]' }));
}

type ClanListEntry = {
    clanNumber: number;
    name: string;
    memberCount: number;
    leaderName: string;
    isOwn: boolean;
};

export function renderClanList(ctx: DisplayClanCtx, clans: ClanListEntry[], maxSize: number) {
    const t = ctx.io.term;
    t.writeln('');
    t.writeln(render(CLAN.listHeader));
    t.writeln(
        render(CLAN.listColumns, {
            num: '#'.padStart(4),
            name: 'Name'.padEnd(20),
            members: 'Members'.padEnd(10),
            leader: 'Leader',
        }),
    );
    if (clans.length === 0) {
        t.writeln(render(CLAN.listEmpty));
        return;
    }
    for (const c of clans) {
        t.writeln(
            render(CLAN.listRow, {
                marker: c.isOwn ? render(CLAN.listOwnMarker) : render(CLAN.listBlankMarker),
                num: String(c.clanNumber).padStart(4),
                name: c.name.padEnd(20),
                members: `${c.memberCount}/${maxSize}`.padEnd(10),
                leader: c.leaderName,
            }),
        );
    }
}

type ClanInfo = {
    clanNumber: number;
    name: string;
    members: { name: string; isLeader: boolean }[];
    maxSize: number;
};

export function renderClanInfo(ctx: DisplayClanCtx, info: ClanInfo | null) {
    const t = ctx.io.term;
    t.writeln('');
    if (!info) {
        t.writeln(render(CLAN.notInClan));
        return;
    }
    t.writeln(render(CLAN.infoHeader));
    const pad = (s: string) => s.padEnd(12);
    t.writeln(render(CLAN.infoLine, { label: pad('Number'), value: info.clanNumber }));
    t.writeln(render(CLAN.infoLine, { label: pad('Name'), value: info.name }));
    t.writeln(
        render(CLAN.infoLine, {
            label: pad('Members'),
            value: `${info.members.length}/${info.maxSize}`,
        }),
    );
    t.writeln(render(CLAN.infoMembersHeader));
    for (const m of info.members) {
        t.writeln(
            render(CLAN.infoMemberRow, {
                name: m.name,
                leaderTag: m.isLeader ? render(CLAN.infoLeaderTag) : '',
            }),
        );
    }
}

type ClanmateLocation = {
    name: string;
    sector: number | null;
    fighters: number;
    shields: number;
    mines: number;
    credits: number;
};

function fmtCredits(n: number): string {
    if (n >= 1_000_000_000) return `${Math.round(n / 1_000_000_000)}B`;
    if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}T`;
    return String(n);
}

export function renderClanmateLocations(ctx: DisplayClanCtx, members: ClanmateLocation[]) {
    const t = ctx.io.term;
    t.writeln('');
    t.writeln(render(CLAN.locationsHeader));
    t.writeln(render(CLAN.locationsDivider));
    if (members.length === 0) {
        t.writeln(render(CLAN.locationsEmpty));
        return;
    }
    for (const m of members) {
        t.writeln(
            render(CLAN.locationsRow, {
                name: m.name.padEnd(35),
                sector: (m.sector === null ? '-' : String(m.sector)).padStart(6),
                fighters: String(m.fighters).padStart(9),
                shields: String(m.shields).padStart(8),
                mines: String(m.mines).padStart(6),
                credits: fmtCredits(m.credits).padStart(11),
            }),
        );
    }
}

export function renderSuccessorChoices(
    ctx: DisplayClanCtx,
    members: { playerId: number; name: string }[],
) {
    const t = ctx.io.term;
    t.writeln(render(CLAN.leaderSuccessorHeader));
    members.forEach((m, i) => {
        t.writeln(
            render(CLAN.leaderSuccessorRow, { num: String(i + 1).padStart(3), name: m.name }),
        );
    });
}
