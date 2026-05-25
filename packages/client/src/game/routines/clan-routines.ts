import { ClientTag, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { CLAN, EVENT } from '../messages/index.js';
import { echoMenuCommand } from '../display.js';
import {
    renderClanList,
    renderClanInfo,
    renderClanmateLocations,
    renderSuccessorChoices,
} from '../display-clan.js';
import { registerRoutine } from './types.js';
import { askChar, askConfirm, askLine, askMultiLine, askNumber } from './prompts.js';
import { awaitResponse, request } from './io.js';
import type { GameContext } from '../types.js';

async function fetchClanMembers(
    ctx: GameContext,
): Promise<{ playerId: number; name: string; isLeader: boolean }[] | null> {
    const info = await request(ctx, { type: ClientTag.ClanInfo }, ServerTag.ClanInfoResult);
    if (info === null) return null;
    if (!info.clan) {
        ctx.io.term.writeln(render(CLAN.notInClan));
        return null;
    }
    return info.clan.members;
}

async function pickClanMember(
    ctx: GameContext,
    members: { playerId: number; name: string; isLeader: boolean }[],
    promptKey: 'transferTargetPrompt' | 'dropMemberPrompt',
    excludeSelf: boolean,
): Promise<{ playerId: number; name: string } | null> {
    const choices = excludeSelf ? members.filter((m) => m.playerId !== ctx.player.id) : members;
    if (choices.length === 0) {
        ctx.io.term.writeln(render(CLAN.invalidSuccessor));
        return null;
    }
    ctx.io.term.writeln(render(CLAN.transferMembersHeader));
    choices.forEach((m, i) => {
        ctx.io.term.writeln(
            render(CLAN.transferMemberRow, { num: String(i + 1).padStart(3), name: m.name }),
        );
    });
    const pick = await askNumber(ctx, render(CLAN[promptKey]), {
        min: 1,
        max: choices.length,
    });
    if (pick === null) return null;
    return choices[pick - 1] ?? null;
}

async function doTransfer(
    ctx: GameContext,
    commandName: string,
    kind: 'credits' | 'drones' | 'shields' | 'mines',
    label: string,
) {
    echoMenuCommand(ctx, commandName);
    const members = await fetchClanMembers(ctx);
    if (!members) return;
    const target = await pickClanMember(ctx, members, 'transferTargetPrompt', true);
    if (!target) return;
    let mineType: 'proximity' | 'seeker' | undefined;
    if (kind === 'mines') {
        const ch = await askChar(ctx, render(CLAN.transferMineTypePrompt), ['p', 'l']);
        if (ch === null) return;
        mineType = ch === 'p' ? 'proximity' : 'seeker';
    }
    const qty = await askNumber(ctx, render(CLAN.transferQtyPrompt), { min: 1 });
    if (qty === null) return;
    const result = await request(
        ctx,
        {
            type: ClientTag.ClanTransfer,
            kind,
            targetPlayerId: target.playerId,
            quantity: qty,
            mineType,
        },
        ServerTag.ClanTransferResult,
    );
    if (!result) return;
    ctx.io.term.writeln(
        render(CLAN.transferSuccess, {
            delivered: result.delivered,
            kind: label,
            target: result.targetName,
        }),
    );
    if (result.delivered < result.quantity) {
        ctx.io.term.writeln(
            render(CLAN.transferDiscarded, {
                discarded: result.quantity - result.delivered,
                kind: label,
            }),
        );
    }
}

registerRoutine('clan_transfer_credits', (ctx) =>
    doTransfer(ctx, 'clan_transfer_credits', 'credits', 'credits'),
);
registerRoutine('clan_transfer_drones', (ctx) =>
    doTransfer(ctx, 'clan_transfer_drones', 'drones', 'drones'),
);
registerRoutine('clan_transfer_shields', (ctx) =>
    doTransfer(ctx, 'clan_transfer_shields', 'shields', 'shields'),
);
registerRoutine('clan_transfer_mines', (ctx) =>
    doTransfer(ctx, 'clan_transfer_mines', 'mines', 'mines'),
);

registerRoutine('clan_memo', async (ctx) => {
    echoMenuCommand(ctx, 'clan_memo');
    ctx.io.term.writeln(render(EVENT.clanMailServerEstablishing));
    ctx.io.term.writeln(render(EVENT.clanMemoTypeBanner));
    const body = await askMultiLine(ctx, render(EVENT.clanMemoLinePrompt));
    if (body === null || body.trim() === '') return;
    const result = await request(ctx, { type: ClientTag.ClanMemo, body }, ServerTag.ClanMemoResult);
    if (!result) return;
    ctx.io.term.writeln(render(CLAN.memoSent, { count: result.recipientCount }));
});

registerRoutine('clan_set_password', async (ctx) => {
    echoMenuCommand(ctx, 'clan_set_password');
    const pw1 = await askLine(ctx, render(CLAN.setPasswordPrompt));
    if (pw1 === null) return;
    const pw2 = await askLine(ctx, render(CLAN.setPasswordConfirmPrompt));
    if (pw2 === null) return;
    if (pw1 !== pw2) {
        ctx.io.term.writeln(render(CLAN.passwordMismatch));
        return;
    }
    const result = await request(
        ctx,
        { type: ClientTag.ClanSetPassword, newPassword: pw1 },
        ServerTag.ClanSetPasswordResult,
    );
    if (!result) return;
    ctx.io.term.writeln(render(CLAN.setPasswordSuccess));
});

registerRoutine('clan_drop_member', async (ctx) => {
    echoMenuCommand(ctx, 'clan_drop_member');
    const members = await fetchClanMembers(ctx);
    if (!members) return;
    const target = await pickClanMember(ctx, members, 'dropMemberPrompt', true);
    if (!target) return;
    const ok = await askConfirm(ctx, render(CLAN.dropConfirmPrompt, { name: target.name }), {
        defaultValue: false,
    });
    if (!ok) return;
    const result = await request(
        ctx,
        { type: ClientTag.ClanDropMember, targetPlayerId: target.playerId },
        ServerTag.ClanDropMemberResult,
    );
    if (!result) return;
    ctx.io.term.writeln(render(CLAN.dropSuccess, { name: result.droppedName }));
});

registerRoutine('clan_locations', async (ctx) => {
    echoMenuCommand(ctx, 'clan_locations');
    const response = await request(
        ctx,
        { type: ClientTag.ClanmateLocations },
        ServerTag.ClanmateLocationsResult,
    );
    if (!response) return;
    renderClanmateLocations(ctx, response.members);
});

registerRoutine('clan_display_list', async (ctx) => {
    echoMenuCommand(ctx, 'clan_display_list');
    ctx.io.term.writeln(render(CLAN.listLoading));
    const response = await request(ctx, { type: ClientTag.ClanList }, ServerTag.ClanListResult);
    if (!response) return;

    const info = await request(ctx, { type: ClientTag.ClanInfo }, ServerTag.ClanInfoResult);
    const maxSize = info?.clan ? info.clan.maxSize : 4;
    renderClanList(ctx, response.clans, maxSize);
});

registerRoutine('clan_display_info', async (ctx) => {
    echoMenuCommand(ctx, 'clan_display_info');
    const response = await request(ctx, { type: ClientTag.ClanInfo }, ServerTag.ClanInfoResult);
    if (!response) return;
    renderClanInfo(ctx, response.clan);
});

registerRoutine('clan_make', async (ctx) => {
    echoMenuCommand(ctx, 'clan_make');
    const name = await askLine(ctx, render(CLAN.namePrompt));
    if (name === null) return;
    const pw1 = await askLine(ctx, render(CLAN.passwordPrompt));
    if (pw1 === null) return;
    const pw2 = await askLine(ctx, render(CLAN.passwordConfirmPrompt));
    if (pw2 === null) return;
    if (pw1 !== pw2) {
        ctx.io.term.writeln(render(CLAN.passwordMismatch));
        return;
    }
    const result = await request(
        ctx,
        { type: ClientTag.ClanCreate, name, password: pw1 },
        ServerTag.ClanCreateResult,
    );
    if (!result) return;
    ctx.player.clanId = result.clanId;
    ctx.io.term.writeln(
        render(CLAN.createSuccess, { number: result.clanNumber, name: result.name }),
    );
});

registerRoutine('clan_join', async (ctx) => {
    echoMenuCommand(ctx, 'clan_join');
    const name = await askLine(ctx, render(CLAN.namePrompt));
    if (name === null) return;
    const pw = await askLine(ctx, render(CLAN.passwordPrompt));
    if (pw === null) return;
    const result = await request(
        ctx,
        { type: ClientTag.ClanJoin, name, password: pw },
        ServerTag.ClanJoinResult,
    );
    if (!result) return;
    ctx.player.clanId = result.clanId;
    ctx.io.term.writeln(render(CLAN.joinSuccess, { number: result.clanNumber, name: result.name }));
});

registerRoutine('clan_leave', async (ctx) => {
    echoMenuCommand(ctx, 'clan_leave');
    const info = await request(ctx, { type: ClientTag.ClanInfo }, ServerTag.ClanInfoResult);
    if (info === null) return;
    if (!info.clan) {
        ctx.io.term.writeln(render(CLAN.notInClan));
        return;
    }

    const members = info.clan.members;
    const isLastMember = members.length <= 1;
    const meId = ctx.player.id;
    const iAmLeader = info.clan.leaderPlayerId === meId;

    if (isLastMember) {
        ctx.io.term.writeln(render(CLAN.dissolveWarning));
        const ok = await askConfirm(ctx, render(CLAN.dissolveConfirm), { defaultValue: false });
        if (!ok) return;
        const result = await request(
            ctx,
            { type: ClientTag.ClanLeave, confirmDissolve: true },
            ServerTag.ClanLeaveResult,
        );
        if (!result) return;
        ctx.player.clanId = null;
        ctx.io.term.writeln(
            render(CLAN.leaveDissolved, {
                personal: result.convertedToPersonal,
                rogue: result.convertedToRogue,
            }),
        );
        return;
    }

    if (iAmLeader) {
        const others = members.filter((m) => m.playerId !== meId);
        renderSuccessorChoices(ctx, others);
        const pick = await askNumber(ctx, render(CLAN.leaderSuccessorPrompt), {
            min: 1,
            max: others.length,
        });
        if (pick === null) return;
        const successor = others[pick - 1];
        if (!successor) {
            ctx.io.term.writeln(render(CLAN.invalidSuccessor));
            return;
        }
        ctx.io.sendMsg({
            type: ClientTag.ClanLeave,
            successorPlayerId: successor.playerId,
        });
    } else {
        ctx.io.sendMsg({ type: ClientTag.ClanLeave });
    }

    const result = await awaitResponse(ctx, [ServerTag.ClanLeaveResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type !== ServerTag.ClanLeaveResult) return;
    ctx.player.clanId = null;
    ctx.io.term.writeln(render(CLAN.leaveLeft));
});
