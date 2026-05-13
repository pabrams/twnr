/**
 * Clan menu: prompts, help text, list/info renders, leave/join/dissolve flows.
 */

import { makeDomain } from './_domain.js';

export const CLAN = makeDomain('CLAN', {
    prompt: '\r\n[mg]Clan command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by][br]=[/br][by]Help[/by][mg])[/mg] [by]:[/by] ',

    activated: '\r\n[bc]<Clan Menu>[/bc]',

    namePrompt: '\r\n[mg]Clan name[/mg] [by]:[/by] ',
    passwordPrompt: '\r\n[mg]Password[/mg] [by]:[/by] ',
    passwordConfirmPrompt: '\r\n[mg]Confirm password[/mg] [by]:[/by] ',
    passwordMismatch: '[br]Passwords do not match.[/br]',

    notInClan: '[w]You are not in a clan.[/w]',
    alreadyInClan: '[br]You are already in a clan.[/br]',

    createSuccess:
        '\r\n[bg]Clan founded: [/bg][bc]#{number} {name}[/bc][bg] — you are the leader.[/bg]',
    joinSuccess: '\r\n[bg]Welcome to [/bg][bc]#{number} {name}[/bc][bg].[/bg]',
    leaveLeft: '\r\n[bg]You have left the clan.[/bg]',
    leaveDissolved:
        '\r\n[by]Clan dissolved.[/by] [bg]{personal} asset(s) converted to personal,[/bg] [br]{rogue} clan asset(s) became rogue.[/br]',

    listLoading: '\r\n[w]Loading clans...[/w]',
    listHeader: '[bc]=== Clans in Universe ===[/bc]',
    listColumns: '   [bw]{num} {name} {members} {leader}[/bw]',
    listRow: '{marker} [by]{num}[/by] [bc]{name}[/bc] [w]{members}[/w] [g]{leader}[/g]',
    listOwnMarker: '[br]*[/br]',
    listBlankMarker: ' ',
    listEmpty: '[w]No clans in this universe yet.[/w]',

    infoHeader: '[bc]=== Your Clan ===[/bc]',
    infoLine: '  [g]{label}[/g] [by]:[/by] [bc]{value}[/bc]',
    infoMembersHeader: '\r\n  [bw]Members:[/bw]',
    infoMemberRow: '    [by]{name}[/by]{leaderTag}',
    infoLeaderTag: ' [bg](leader)[/bg]',

    dissolveWarning:
        '\r\n[br]You are the last member.[/br] [w]Leaving dissolves the clan.[/w]\r\n' +
        '[w]Clan ships/drones/mines/beacons in this sector become personal.[/w]\r\n' +
        '[w]Clan assets elsewhere (including all clan planets) become rogue.[/w]\r\n' +
        '[w]Cancel and transfer ownership manually if you want to keep specific assets.[/w]',
    dissolveConfirm: '\r\n[by]Confirm dissolve clan? (y/[N])[/by] ',

    leaderSuccessorPrompt: '\r\n[mg]Pick a successor by number (Q to cancel)[/mg] [by]?[/by] ',
    leaderSuccessorHeader: '\r\n[w]As leader, you must designate a successor:[/w]',
    leaderSuccessorRow: '  [by]{num}[/by]  [bc]{name}[/bc]',

    needSuccessor: '[br]Designate a successor first.[/br]',
    invalidSuccessor: '[br]Invalid successor selection.[/br]',

    transferMembersHeader: '\r\n[w]Clan members:[/w]',
    transferMemberRow: '  [by]{num}[/by]  [bc]{name}[/bc]',
    transferTargetPrompt:
        '\r\n[mg]Recipient ([/mg][by]#[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
    transferQtyPrompt:
        '\r\n[mg]Quantity ([/mg][by]#[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
    transferMineTypePrompt:
        '\r\n[mg]Mine type ([/mg][by]P[/by][mg]roximity,[/mg][by]L[/by][mg]impet,[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
    transferSuccess:
        '\r\n[bg]Sent [/bg][bc]{delivered}[/bc] [bg]{kind} to [/bg][bc]{target}[/bc][bg].[/bg]',
    transferDiscarded:
        '\r\n[by]Note: [/by][w]{discarded} {kind} discarded (recipient at capacity).[/w]',

    memoBodyPrompt: '\r\n[mg]Memo text (Q to cancel)[/mg] [by]:[/by] ',
    memoSent: '\r\n[bg]Memo sent to [/bg][bc]{count}[/bc] [bg]clan member(s).[/bg]',

    setPasswordPrompt: '\r\n[mg]New clan password[/mg] [by]:[/by] ',
    setPasswordConfirmPrompt: '\r\n[mg]Confirm password[/mg] [by]:[/by] ',
    setPasswordSuccess: '\r\n[bg]Clan password updated.[/bg]',

    dropMemberPrompt:
        '\r\n[mg]Drop which member ([/mg][by]#[/by][mg],[/mg][by]Q[/by][mg])[/mg] [by]?[/by] ',
    dropConfirmPrompt: '\r\n[by]Confirm dropping [/by][bc]{name}[/bc] [by]from clan? (y/[N])[/by] ',
    dropSuccess: '\r\n[bg]Dropped [/bg][bc]{name}[/bc][bg] from the clan.[/bg]',

    incomingMemoHeader: '\r\n[by]== Memo ==[/by]',
    incomingMemoLine: '[w]{from}: {body}[/w]',
    notLeader: '[br]Only the clan leader can do that.[/br]',
});
