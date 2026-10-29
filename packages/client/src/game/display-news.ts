import type {
    GalacticNewsEntry,
    GameEvent,
    GameEventClanRef,
    GameEventOwnerRef,
    GameEventShipTypeRef,
} from '@twnr/shared';
import { render } from './renderer.js';
import { NEWS, NEWS_EVENT } from './messages/index.js';

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

export function formatStardate(d: Date): string {
    return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}

export function formatNewsTime(d: Date): string {
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function parseStardate(text: string): Date | null {
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text.trim());
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const d = new Date(Date.UTC(year, month - 1, day));
    const isRealDate =
        d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
    return isRealDate ? d : null;
}

export function startOfUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function nextUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

function formatClan(clan: GameEventClanRef): string {
    return render(NEWS.clanLabel, { clanNumber: clan.clanNumber, name: clan.name });
}

function formatOwner(owner: GameEventOwnerRef): string {
    switch (owner.kind) {
        case 'player':
            return owner.name;
        case 'clan':
            return formatClan(owner);
        case 'rogue':
            return render(NEWS.ownerRogue);
    }
}

function formatShipType(shipType: GameEventShipTypeRef): string {
    return shipType.displayName ?? shipType.slug;
}

export function renderNewsEvent(event: GameEvent): string {
    switch (event.kind) {
        case 'player_ship_destroyed_by_ship_combat':
            return render(NEWS_EVENT[event.kind], {
                attacker: event.attacker.name,
                victim: event.victim.name,
                shipType: formatShipType(event.destroyedShipType),
                sector: event.sectorNumber,
            });
        case 'player_ship_destroyed_by_sector_defenses':
            return render(NEWS_EVENT[event.kind], {
                victim: event.victim.name,
                shipType: formatShipType(event.destroyedShipType),
                defense: render(
                    event.defenseType === 'drones' ? NEWS.defenseDrones : NEWS.defenseMines,
                ),
                owner: formatOwner(event.defenseOwner),
                sector: event.sectorNumber,
            });
        case 'planet_collision':
            return render(NEWS_EVENT[event.kind], {
                planet: event.planet.name,
                collidingWith: event.collidingWith.name,
                sector: event.sectorNumber,
            });
        case 'planet_destroyed':
            return render(NEWS_EVENT[event.kind], {
                destroyer: event.destroyer.name,
                planet: event.planet.name,
                sector: event.sectorNumber,
            });
        case 'player_joined_universe':
            return render(NEWS_EVENT[event.kind], { player: event.player.name });
        case 'player_issued_ship':
            return render(NEWS_EVENT[event.kind], {
                player: event.player.name,
                shipType: formatShipType(event.shipType),
            });
        case 'clan_created':
            return render(NEWS_EVENT[event.kind], {
                founder: event.founder.name,
                clan: formatClan(event.clan),
            });
        case 'player_joined_clan':
        case 'player_left_clan':
        case 'player_kicked_from_clan':
            return render(NEWS_EVENT[event.kind], {
                player: event.player.name,
                clan: formatClan(event.clan),
            });
        case 'clan_disbanded':
            return render(NEWS_EVENT[event.kind], { clan: formatClan(event.clan) });
        case 'planet_claimed':
            return render(NEWS_EVENT[event.kind], {
                planet: event.planet.name,
                owner: formatOwner(event.owner),
                claimedBy: event.claimedBy.name,
                sector: event.sectorNumber,
            });
        case 'port_built':
            return render(NEWS_EVENT[event.kind], {
                port: event.portName,
                owner: formatOwner(event.owner),
                sector: event.sectorNumber,
            });
        case 'base_upgraded':
            return render(NEWS_EVENT[event.kind], {
                planet: event.planet.name,
                level: event.level,
                sector: event.sectorNumber,
            });
    }
}

function renderNewsLine(entry: GalacticNewsEntry): string {
    return render(NEWS.entryLine, {
        time: formatNewsTime(new Date(entry.createdAt)),
        text: renderNewsEvent(entry.event),
    });
}

export function buildNewsLines(entries: GalacticNewsEntry[], from: Date, today: Date): string[] {
    const lines: string[] = [];
    let entryIdx = 0;
    for (let day = startOfUtcDay(from); day <= today; day = nextUtcDay(day)) {
        const dayEnd = nextUtcDay(day);
        const isLastDay = dayEnd > today;
        lines.push(render(NEWS.dayHeader, { date: formatStardate(day) }));
        while (
            entryIdx < entries.length &&
            (isLastDay || new Date(entries[entryIdx].createdAt) < dayEnd)
        ) {
            lines.push(renderNewsLine(entries[entryIdx]));
            entryIdx++;
        }
    }
    return lines;
}
