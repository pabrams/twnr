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
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** Local midnight of a YYYY/MM/DD string; null unless it is a real calendar date. */
export function parseStardate(text: string): Date | null {
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text.trim());
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const d = new Date(year, month - 1, day);
    const isRealDate =
        d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
    return isRealDate ? d : null;
}

export function startOfLocalDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nextLocalDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
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

/** One headed block per local day from `from` through `today`, days without news included. */
export function buildNewsLines(entries: GalacticNewsEntry[], from: Date, today: Date): string[] {
    const lines: string[] = [];
    let entryIdx = 0;
    for (let day = startOfLocalDay(from); day <= today; day = nextLocalDay(day)) {
        const dayEnd = nextLocalDay(day);
        const isLastDay = dayEnd > today;
        lines.push(render(NEWS.dayHeader, { date: formatStardate(day) }));
        while (
            entryIdx < entries.length &&
            (isLastDay || new Date(entries[entryIdx].createdAt) < dayEnd)
        ) {
            lines.push(renderNewsEvent(entries[entryIdx].event));
            entryIdx++;
        }
    }
    return lines;
}
