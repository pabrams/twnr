import { describe, it, expect, vi } from 'vitest';
import { Commands, Menu } from '@twnr/shared';
import type { GameContext } from '../src/game/types.js';
import { getRoutine } from '../src/game/routines/types.js';
import '../src/game/routines/combat-routines.js';

const STRIP_ANSI = /\x1b\[[0-9;]*m/g;

type Reply = Record<string, unknown>;

interface Pending {
    types: Set<string>;
    resolve: (msg: Reply | null) => void;
}

interface Resolver {
    mode: 'line' | 'char';
    resolve: (value: string | null) => void;
}

function createHarness(replies: Record<string, Reply>) {
    const sent: { type: string; [key: string]: unknown }[] = [];
    const written: string[] = [];
    const input: { pendingResolver: Resolver | null; pendingResponse: Pending | null } = {
        pendingResolver: null,
        pendingResponse: null,
    };
    const ctx = {
        io: {
            term: {
                write: (text: string) => written.push(text),
                writeln: (text: string) => written.push(text),
            },
            sendMsg: (msg: { type: string }) => {
                sent.push(msg);
                const reply = replies[msg.type];
                if (!reply) return;
                queueMicrotask(() => {
                    const pending = input.pendingResponse;
                    input.pendingResponse = null;
                    pending?.resolve(reply);
                });
            },
        },
        input,
    } as unknown as GameContext;

    async function answer(value: string): Promise<void> {
        await vi.waitFor(() => {
            if (!input.pendingResolver) throw new Error('no prompt is waiting');
        });
        const resolver = input.pendingResolver!;
        input.pendingResolver = null;
        resolver.resolve(value);
    }

    const runAttack = () => getRoutine(Menu.Sector, 'attackMenu')!(ctx, '');
    const sentTypes = () => sent.map((msg) => msg.type);
    const printed = () => written.join('\n').replace(STRIP_ANSI, '');

    return { answer, runAttack, sent, sentTypes, printed };
}

const targetsReply = {
    type: Commands.AttackTargets.reply.name,
    outcome: 'ok',
    players: [
        { id: 2, name: 'p1', shipTypeName: 'gunstar', shipTypeDisplayName: 'Havoc GunStar', drones: 164 },
        { id: 3, name: 'p2', shipTypeName: 'cruiser', shipTypeDisplayName: null, drones: 10 },
    ],
    shipDrones: 270,
    beaconPresent: false,
};

const poweredUpReply = {
    type: Commands.PowerUpWeapons.reply.name,
    outcome: 'ok',
    maxWaveDrones: 100,
};

const attackResultReply = {
    type: Commands.AttackShip.reply.name,
    outcome: 'ok',
    destroyed: false,
    attackerDronesLost: 100,
    attackerDronesRemaining: 170,
    defenderDronesLost: 70,
    defenderDronesRemaining: 94,
};

describe('attack routine', () => {
    it('asks about each player in turn and stops when all are declined', async () => {
        const h = createHarness({ [Commands.AttackTargets.name]: targetsReply });
        const done = h.runAttack();
        await h.answer('n');
        await h.answer('n');
        await done;
        expect(h.printed()).toContain("Attack p1's Havoc GunStar (270-164) (Y/N) [N]?");
        expect(h.printed()).toContain("Attack p2's cruiser (270-10) (Y/N) [N]?");
        expect(h.sentTypes()).toEqual([Commands.AttackTargets.name]);
    });

    it('sends one wave at the chosen player, reports it, and redisplays the sector', async () => {
        const h = createHarness({
            [Commands.AttackTargets.name]: targetsReply,
            [Commands.PowerUpWeapons.name]: poweredUpReply,
            [Commands.AttackShip.name]: attackResultReply,
        });
        const done = h.runAttack();
        await h.answer('n');
        await h.answer('y');
        await h.answer('100');
        await done;
        expect(h.sentTypes()).toEqual([
            Commands.AttackTargets.name,
            Commands.PowerUpWeapons.name,
            Commands.AttackShip.name,
            Commands.SectorDisplay.name,
        ]);
        expect(h.sent[1]).toMatchObject({ targetPlayerId: 3 });
        expect(h.sent[2]).toMatchObject({ targetPlayerId: 3, drones: 100 });
        expect(h.printed()).toContain('How many drones do you wish to use (0 to 100) [0]?');
        expect(h.printed()).toContain('You lost 100 drone(s), 170 remain.');
        expect(h.printed()).toContain('You destroyed 70 enemy drones, 94 remain.');
    });

    it('sends nothing more when the wave size is left at the default of zero', async () => {
        const h = createHarness({
            [Commands.AttackTargets.name]: targetsReply,
            [Commands.PowerUpWeapons.name]: poweredUpReply,
        });
        const done = h.runAttack();
        await h.answer('y');
        await h.answer('');
        await done;
        expect(h.sentTypes()).toEqual([Commands.AttackTargets.name, Commands.PowerUpWeapons.name]);
    });

    it('stops when powering up is refused', async () => {
        const h = createHarness({
            [Commands.AttackTargets.name]: targetsReply,
            [Commands.PowerUpWeapons.name]: {
                type: Commands.PowerUpWeapons.reply.name,
                outcome: 'refused',
                reason: 'targetNotHere',
            },
        });
        const done = h.runAttack();
        await h.answer('y');
        await done;
        expect(h.sentTypes()).toEqual([Commands.AttackTargets.name, Commands.PowerUpWeapons.name]);
    });
});
