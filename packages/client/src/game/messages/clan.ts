/**
 * Clan menu: prompts, help text, list/info renders, leave/join/dissolve flows.
 */

import { makeDomain } from './_domain.js';

export const CLAN = makeDomain('CLAN', {
    prompt: '\r\n[mg]Corporate command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by][br]=[/br][by]Help[/by][mg])[/mg] [by]:[/by] ',

    activated: '\r\n[bc]<Clan Menu>[/bc]',

    namePrompt: '\r\n[mg]Clan name[/mg] [by]:[/by] ',
    passwordPrompt: '\r\n[mg]Password[/mg] [by]:[/by] ',
    passwordConfirmPrompt: '\r\n[mg]Confirm password[/mg] [by]:[/by] ',
    passwordMismatch: '[br]Passwords do not match.[/br]',

    notInClan: '[w]You are not in a clan.[/w]',
    alreadyInClan: '[br]You are already in a clan.[/br]',

    createSuccess: '\r\n[bg]Clan founded: [/bg][bc]#{number} {name}[/bc][bg] — you are the leader.[/bg]',
    joinSuccess: '\r\n[bg]Welcome to [/bg][bc]#{number} {name}[/bc][bg].[/bg]',
    leaveLeft: '\r\n[bg]You have left the clan.[/bg]',
    leaveDissolved:
        '\r\n[by]Clan dissolved.[/by] [bg]{personal} asset(s) converted to personal,[/bg] [br]{rogue} clan asset(s) became rogue.[/br]',

    listLoading: '\r\n[w]Loading clans...[/w]',
    listHeader: '[bc]=== Clans in Universe ===[/bc]',
    listColumns: '  [bw]{num} {name} {members} {leader}[/bw]',
    listRow: '  [by]{num}[/by] [bc]{name}[/bc] [w]{members}[/w] [g]{leader}[/g]',
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
});
