import { ClientMsgType, ServerMsgType } from '@twnr/shared';
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
    ctx.io.sendMsg({ type: ClientMsgType.ClanInfo });
    const info = await awaitResponse(ctx, [ServerMsgType.ClanInfoResult, ServerMsgType.Error]);
    if (info === null || info.type !== ServerMsgType.ClanInfoResult) return null;
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
        const ch = await askChar(ctx, render(CLAN.transferMineTypePrompt), ['p', 's']);
        if (ch === null) return;
        mineType = ch === 'p' ? 'proximity' : 'seeker';
    }
    const qty = await askNumber(ctx, render(CLAN.transferQtyPrompt), { min: 1 });
    if (qty === null) return;
    ctx.io.sendMsg({
        type: ClientMsgType.ClanTransfer,
        kind,
        targetPlayerId: target.playerId,
        quantity: qty,
        mineType,
    });
    const result = await awaitResponse(ctx, [
        ServerMsgType.ClanTransferResult,
        ServerMsgType.Error,
    ]);
    if (result === null || result.type !== ServerMsgType.ClanTransferResult) return;
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
    ctx.io.sendMsg({ type: ClientMsgType.ClanMemo, body });
    const result = await awaitResponse(ctx, [ServerMsgType.ClanMemoResult, ServerMsgType.Error]);
    if (result === null || result.type !== ServerMsgType.ClanMemoResult) return;
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
    ctx.io.sendMsg({ type: ClientMsgType.ClanSetPassword, newPassword: pw1 });
    const result = await awaitResponse(ctx, [
        ServerMsgType.ClanSetPasswordResult,
        ServerMsgType.Error,
    ]);
    if (result === null || result.type !== ServerMsgType.ClanSetPasswordResult) return;
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
    ctx.io.sendMsg({ type: ClientMsgType.ClanDropMember, targetPlayerId: target.playerId });
    const result = await awaitResponse(ctx, [
        ServerMsgType.ClanDropMemberResult,
        ServerMsgType.Error,
    ]);
    if (result === null || result.type !== ServerMsgType.ClanDropMemberResult) return;
    ctx.io.term.writeln(render(CLAN.dropSuccess, { name: result.droppedName }));
});

registerRoutine('clan_help', (ctx) => {
    showClanHelp(ctx);
});

registerRoutine('clan_display_list', async (ctx) => {
    echoCommand(ctx, 'clanDisplayList');
    ctx.io.term.writeln(render(CLAN.listLoading));
    ctx.io.sendMsg({ type: ClientMsgType.ClanList });
    const response = await awaitResponse(ctx, [ServerMsgType.ClanListResult, ServerMsgType.Error]);
    if (response === null) return;
    if (response.type !== ServerMsgType.ClanListResult) return;

    ctx.io.sendMsg({ type: ClientMsgType.ClanInfo });
    const info = await awaitResponse(ctx, [ServerMsgType.ClanInfoResult, ServerMsgType.Error]);
    const maxSize =
        info && info.type === ServerMsgType.ClanInfoResult && info.clan ? info.clan.maxSize : 4;
    renderClanList(ctx, response.clans, maxSize);
});

registerRoutine('clan_display_info', async (ctx) => {
    echoCommand(ctx, 'clanDisplayInfo');
    ctx.io.sendMsg({ type: ClientMsgType.ClanInfo });
    const response = await awaitResponse(ctx, [ServerMsgType.ClanInfoResult, ServerMsgType.Error]);
    if (response === null) return;
    if (response.type !== ServerMsgType.ClanInfoResult) return;
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
    ctx.io.sendMsg({ type: ClientMsgType.ClanCreate, name, password: pw1 });
    const result = await awaitResponse(ctx, [ServerMsgType.ClanCreateResult, ServerMsgType.Error]);
    if (result === null) return;
    if (result.type !== ServerMsgType.ClanCreateResult) return;
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
    ctx.io.sendMsg({ type: ClientMsgType.ClanJoin, name, password: pw });
    const result = await awaitResponse(ctx, [ServerMsgType.ClanJoinResult, ServerMsgType.Error]);
    if (result === null) return;
    if (result.type !== ServerMsgType.ClanJoinResult) return;
    ctx.player.clanId = result.clanId;
    ctx.io.term.writeln(render(CLAN.joinSuccess, { number: result.clanNumber, name: result.name }));
});

registerRoutine('clan_leave', async (ctx) => {
    echoCommand(ctx, 'clanLeave');
    ctx.io.sendMsg({ type: ClientMsgType.ClanInfo });
    const info = await awaitResponse(ctx, [ServerMsgType.ClanInfoResult, ServerMsgType.Error]);
    if (info === null) return;
    if (info.type !== ServerMsgType.ClanInfoResult) return;
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
        ctx.io.sendMsg({ type: ClientMsgType.ClanLeave, confirmDissolve: true });
        const result = await awaitResponse(ctx, [
            ServerMsgType.ClanLeaveResult,
            ServerMsgType.Error,
        ]);
        if (result === null) return;
        if (result.type !== ServerMsgType.ClanLeaveResult) return;
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
            type: ClientMsgType.ClanLeave,
            successorPlayerId: successor.playerId,
        });
    } else {
        ctx.io.sendMsg({ type: ClientMsgType.ClanLeave });
    }

    const result = await awaitResponse(ctx, [ServerMsgType.ClanLeaveResult, ServerMsgType.Error]);
    if (result === null) return;
    if (result.type !== ServerMsgType.ClanLeaveResult) return;
    ctx.player.clanId = null;
    ctx.io.term.writeln(render(CLAN.leaveLeft));
});
