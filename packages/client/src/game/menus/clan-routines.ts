import { ClientMsgType, ServerMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { CLAN } from '../messages/index.js';
import {
    showClanHelp,
    renderClanList,
    renderClanInfo,
    renderSuccessorChoices,
} from '../display-clan.js';
import { registerRoutine } from './types.js';
import { askConfirm, askLine, askNumber, awaitResponse } from './prompts.js';

registerRoutine('clan_help', (ctx) => {
    showClanHelp(ctx);
});

registerRoutine('clan_display_list', async (ctx) => {
    ctx.io.term.writeln(render(CLAN.listLoading));
    ctx.io.sendMsg({ type: ClientMsgType.ClanList });
    const response = await awaitResponse(ctx, [
        ServerMsgType.ClanListResult,
        ServerMsgType.Error,
    ]);
    if (response === null) return;
    if (response.type !== ServerMsgType.ClanListResult) return;

    ctx.io.sendMsg({ type: ClientMsgType.ClanInfo });
    const info = await awaitResponse(ctx, [
        ServerMsgType.ClanInfoResult,
        ServerMsgType.Error,
    ]);
    const maxSize =
        info && info.type === ServerMsgType.ClanInfoResult && info.clan ? info.clan.maxSize : 4;
    renderClanList(ctx, response.clans, maxSize);
});

registerRoutine('clan_display_info', async (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ClanInfo });
    const response = await awaitResponse(ctx, [
        ServerMsgType.ClanInfoResult,
        ServerMsgType.Error,
    ]);
    if (response === null) return;
    if (response.type !== ServerMsgType.ClanInfoResult) return;
    renderClanInfo(ctx, response.clan);
});

registerRoutine('clan_make', async (ctx) => {
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
    const result = await awaitResponse(ctx, [
        ServerMsgType.ClanCreateResult,
        ServerMsgType.Error,
    ]);
    if (result === null) return;
    if (result.type !== ServerMsgType.ClanCreateResult) return;
    ctx.io.term.writeln(
        render(CLAN.createSuccess, { number: result.clanNumber, name: result.name }),
    );
});

registerRoutine('clan_join', async (ctx) => {
    const name = await askLine(ctx, render(CLAN.namePrompt));
    if (name === null) return;
    const pw = await askLine(ctx, render(CLAN.passwordPrompt));
    if (pw === null) return;
    ctx.io.sendMsg({ type: ClientMsgType.ClanJoin, name, password: pw });
    const result = await awaitResponse(ctx, [
        ServerMsgType.ClanJoinResult,
        ServerMsgType.Error,
    ]);
    if (result === null) return;
    if (result.type !== ServerMsgType.ClanJoinResult) return;
    ctx.io.term.writeln(
        render(CLAN.joinSuccess, { number: result.clanNumber, name: result.name }),
    );
});

registerRoutine('clan_leave', async (ctx) => {
    ctx.io.sendMsg({ type: ClientMsgType.ClanInfo });
    const info = await awaitResponse(ctx, [
        ServerMsgType.ClanInfoResult,
        ServerMsgType.Error,
    ]);
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

    const result = await awaitResponse(ctx, [
        ServerMsgType.ClanLeaveResult,
        ServerMsgType.Error,
    ]);
    if (result === null) return;
    if (result.type !== ServerMsgType.ClanLeaveResult) return;
    ctx.io.term.writeln(render(CLAN.leaveLeft));
});
