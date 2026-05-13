import { ClientTag, ServerTag } from '@twnr/shared';
import { render } from '../renderer.js';
import { CLAN } from '../messages/index.js';
import { echoCommand } from '../display.js';
import {
    showClanHelp,
    renderClanList,
    renderClanInfo,
    renderSuccessorChoices,
} from '../display-clan.js';
import { registerRoutine } from './types.js';
import { askChar, askConfirm, askLine, askNumber, awaitResponse } from './prompts.js';
import type { GameContext } from '../types.js';

async function fetchClanMembers(
    ctx: GameContext,
): Promise<{ playerId: number; name: string; isLeader: boolean }[] | null> {
    ctx.io.sendMsg({ type: ClientTag.ClanInfo });
    const info = await awaitResponse(ctx, [ServerTag.ClanInfoResult, ServerTag.Error]);
    if (info === null || info.type !== ServerTag.ClanInfoResult) return null;
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
    kind: 'credits' | 'drones' | 'shields' | 'mines',
    label: string,
) {
    const echoKey =
        kind === 'credits'
            ? 'clanTransferCredits'
            : kind === 'drones'
              ? 'clanTransferDrones'
              : kind === 'shields'
                ? 'clanTransferShields'
                : 'clanTransferMines';
    echoCommand(ctx, echoKey);
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
    ctx.io.sendMsg({
        type: ClientTag.ClanTransfer,
        kind,
        targetPlayerId: target.playerId,
        quantity: qty,
        mineType,
    });
    const result = await awaitResponse(ctx, [
        ServerTag.ClanTransferResult,
        ServerTag.Error,
    ]);
    if (result === null || result.type !== ServerTag.ClanTransferResult) return;
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

registerRoutine('clan_transfer_credits', (ctx) => doTransfer(ctx, 'credits', 'credits'));
registerRoutine('clan_transfer_drones', (ctx) => doTransfer(ctx, 'drones', 'drones'));
registerRoutine('clan_transfer_shields', (ctx) => doTransfer(ctx, 'shields', 'shields'));
registerRoutine('clan_transfer_mines', (ctx) => doTransfer(ctx, 'mines', 'mines'));

registerRoutine('clan_memo', async (ctx) => {
    echoCommand(ctx, 'clanMemo');
    const body = await askLine(ctx, render(CLAN.memoBodyPrompt));
    if (body === null) return;
    ctx.io.sendMsg({ type: ClientTag.ClanMemo, body });
    const result = await awaitResponse(ctx, [ServerTag.ClanMemoResult, ServerTag.Error]);
    if (result === null || result.type !== ServerTag.ClanMemoResult) return;
    ctx.io.term.writeln(render(CLAN.memoSent, { count: result.recipientCount }));
});

registerRoutine('clan_set_password', async (ctx) => {
    echoCommand(ctx, 'clanSetPassword');
    const pw1 = await askLine(ctx, render(CLAN.setPasswordPrompt));
    if (pw1 === null) return;
    const pw2 = await askLine(ctx, render(CLAN.setPasswordConfirmPrompt));
    if (pw2 === null) return;
    if (pw1 !== pw2) {
        ctx.io.term.writeln(render(CLAN.passwordMismatch));
        return;
    }
    ctx.io.sendMsg({ type: ClientTag.ClanSetPassword, newPassword: pw1 });
    const result = await awaitResponse(ctx, [
        ServerTag.ClanSetPasswordResult,
        ServerTag.Error,
    ]);
    if (result === null || result.type !== ServerTag.ClanSetPasswordResult) return;
    ctx.io.term.writeln(render(CLAN.setPasswordSuccess));
});

registerRoutine('clan_drop_member', async (ctx) => {
    echoCommand(ctx, 'clanDropMember');
    const members = await fetchClanMembers(ctx);
    if (!members) return;
    const target = await pickClanMember(ctx, members, 'dropMemberPrompt', true);
    if (!target) return;
    const ok = await askConfirm(ctx, render(CLAN.dropConfirmPrompt, { name: target.name }), {
        defaultValue: false,
    });
    if (!ok) return;
    ctx.io.sendMsg({ type: ClientTag.ClanDropMember, targetPlayerId: target.playerId });
    const result = await awaitResponse(ctx, [
        ServerTag.ClanDropMemberResult,
        ServerTag.Error,
    ]);
    if (result === null || result.type !== ServerTag.ClanDropMemberResult) return;
    ctx.io.term.writeln(render(CLAN.dropSuccess, { name: result.droppedName }));
});

registerRoutine('clan_help', (ctx) => {
    showClanHelp(ctx);
});

registerRoutine('clan_display_list', async (ctx) => {
    echoCommand(ctx, 'clanDisplayList');
    ctx.io.term.writeln(render(CLAN.listLoading));
    ctx.io.sendMsg({ type: ClientTag.ClanList });
    const response = await awaitResponse(ctx, [ServerTag.ClanListResult, ServerTag.Error]);
    if (response === null) return;
    if (response.type !== ServerTag.ClanListResult) return;

    ctx.io.sendMsg({ type: ClientTag.ClanInfo });
    const info = await awaitResponse(ctx, [ServerTag.ClanInfoResult, ServerTag.Error]);
    const maxSize =
        info && info.type === ServerTag.ClanInfoResult && info.clan ? info.clan.maxSize : 4;
    renderClanList(ctx, response.clans, maxSize);
});

registerRoutine('clan_display_info', async (ctx) => {
    echoCommand(ctx, 'clanDisplayInfo');
    ctx.io.sendMsg({ type: ClientTag.ClanInfo });
    const response = await awaitResponse(ctx, [ServerTag.ClanInfoResult, ServerTag.Error]);
    if (response === null) return;
    if (response.type !== ServerTag.ClanInfoResult) return;
    renderClanInfo(ctx, response.clan);
});

registerRoutine('clan_make', async (ctx) => {
    echoCommand(ctx, 'clanMake');
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
    ctx.io.sendMsg({ type: ClientTag.ClanCreate, name, password: pw1 });
    const result = await awaitResponse(ctx, [ServerTag.ClanCreateResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type !== ServerTag.ClanCreateResult) return;
    ctx.player.clanId = result.clanId;
    ctx.io.term.writeln(
        render(CLAN.createSuccess, { number: result.clanNumber, name: result.name }),
    );
});

registerRoutine('clan_join', async (ctx) => {
    echoCommand(ctx, 'clanJoin');
    const name = await askLine(ctx, render(CLAN.namePrompt));
    if (name === null) return;
    const pw = await askLine(ctx, render(CLAN.passwordPrompt));
    if (pw === null) return;
    ctx.io.sendMsg({ type: ClientTag.ClanJoin, name, password: pw });
    const result = await awaitResponse(ctx, [ServerTag.ClanJoinResult, ServerTag.Error]);
    if (result === null) return;
    if (result.type !== ServerTag.ClanJoinResult) return;
    ctx.player.clanId = result.clanId;
    ctx.io.term.writeln(render(CLAN.joinSuccess, { number: result.clanNumber, name: result.name }));
});

registerRoutine('clan_leave', async (ctx) => {
    echoCommand(ctx, 'clanLeave');
    ctx.io.sendMsg({ type: ClientTag.ClanInfo });
    const info = await awaitResponse(ctx, [ServerTag.ClanInfoResult, ServerTag.Error]);
    if (info === null) return;
    if (info.type !== ServerTag.ClanInfoResult) return;
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
        ctx.io.sendMsg({ type: ClientTag.ClanLeave, confirmDissolve: true });
        const result = await awaitResponse(ctx, [
            ServerTag.ClanLeaveResult,
            ServerTag.Error,
        ]);
        if (result === null) return;
        if (result.type !== ServerTag.ClanLeaveResult) return;
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
