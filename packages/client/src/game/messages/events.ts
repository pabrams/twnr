/**
 * Gameplay events: combat, drones, terraforming, hyperspace, alerts.
 */

import { makeDomain } from './_domain.js';

export const EVENT = makeDomain('EVENT', {
    autopilotEngaged: '\r\n[bg:b]<Autopilot engaging>[/bg:b]',
    autopilotDisengaged: '\r\n[br]Autopilot disengaged — hostile drones![/br]',
    autopilotCancelled: '\r\n[br]Autopilot cancelled.[/br]',
    autopilotResuming: '[bc]Autopilot resuming...[/bc]',
    autopilotWarping: '\r\n[y]Auto-warping to sector [by]{sector}[/by][/y]',
    autopilotArrived: '\r\n[bc]Arriving at sector [by]{sector}[/by]. Autopilot disengaging.[/bc]',
    noPathFound: '\r\n[br]No path found to that sector.[/br]',
    alreadyInSector: '\r\n[y]You are already in that sector.[/y]',
    noShip: '\r\n[br]You do not have a ship.[/br]',
    shipDestroyed: '\r\n[br]*** Your ship was destroyed: {reason} ***[/br]',

    attackDestroyed: '[br]{message}[/br]',
    attackCompleted: '[by]{message}[/by]',
    attackStat: '  [by]{label}[/by]: {value}',

    deployDronesInfo:
        '[g]You have [by]{total}[/by] drones available.[/g]\r\n' +
        '[g]Your ship can support a maximum of [by]{max}[/by] drones, so you have to leave at least [by]{minInSector}[/by].[/g]',

    deployDronesPrompt: '[g]How many drones do you want defending this sector? [{minInSector}][/g]',
    deployOwnershipPrompt:
        '\r\n[mg]Deploy as ([/mg][by]P[/by][mg]ersonal, [/mg][by]C[/by][mg]lan, [/mg][by]Q[/by][mg]) [/mg][by]?[/by] ',

    deployDronesResult:
        '\r\n[bc]Done. You have [by]{ship}[/by] drones in close support and [by]{sector}[/by] defending the sector.[/bc]',

    handleMinesInfo:
        '[g]{label} mines — [by]{ship}[/by] on ship, [by]{sector}[/by] in sector ' +
        '([by]{total}[/by] total available, ship capacity [by]{max}[/by]).[/g]',
    handleMinesPrompt: '[g]How many {label} mines should be in this sector? (Q to cancel) [/g]',
    deployMineResult:
        '\r\n[bc]{label} mines — [by]{ship}[/by] on ship, [by]{sector}[/by] in sector.[/bc]',

    combatLost:
        '[g]Lost [by]{lost}[/by] drones. Sector drones remaining: [br]{remaining}[/br]. Ship drones: [g]{ship}[/g]',
    sectorCleared: '[bg]Sector cleared![/bg]',
    retreated: '\r\n[by]Retreated to sector[/by] [bc]{sector}[/bc]',

    alertIntrusion:
        '[by]Alert:[/by] Drones in sector [bc]{sector}[/bc] report [bm]{intruder}[/bm] warped into the sector.',
    alertAttacked:
        '[br]Alert:[/br] [bm]{intruder}[/bm] destroyed [by]{lost}[/by] of your drones in sector [bc]{sector}[/bc]!',
    alertDestroyed:
        '[br]Alert:[/br] [bm]{intruder}[/bm] destroyed all your drones in sector [bc]{sector}[/bc]!',

    planetDestroyed: '\r\n[br]Planet {name} destroyed![/br]',

    terraformDevicesAvailable: '\r\n[g]You have[/g] [bc]{count}[/bc] [g]Terraform Devices.[/g]',
    terraformNoDevices: '\r\n[bg]You have no Terraform Devices.[/bg]',
    terraformConfirm:
        '[by]Do you wish to launch one?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg] [mg][[/mg][by]N[/by][mg]][/mg] ',
    terraformNarrative:
        '\r\n[g]Your science officer locates a land mass with the requisite attributes, and your\r\n' +
        'communications officer contacts the galactic planet registry to record your\r\n' +
        'intention to terraform in this sector.[/g]\r\n\r\n' +
        '[g]Orbiting the target, you launch a terraform device. A few minutes later, you\r\n' +
        'see a bright point where the device touches down, and a brilliant glowing ring\r\n' +
        'expands quickly from the point of impact until it has spread over the entire\r\n' +
        'surface.[/g]\r\n\r\n' +
        '[g]Now you just need some colonists to settle here and work the natural\r\n' +
        'resources.[/g]',
    terraformNamePrompt:
        '\r\n[by]What do you want to name this planet?[/by] [g]({type}) (Leave blank for random name)[/g]\r\n[mg]>[/mg] ',
    terraformOwnershipPrompt:
        '\r\n[by]Should this be a ([/by][bc]C[/bc][by])lan planet or ([/by][bc]P[/bc][by])ersonal planet?[/by] [mg][[/mg][by]P[/by][mg]][/mg] ',
    terraformConfirmed: '\r\n[bg]Planet[/bg] [bc]{name}[/bc] [bg]registered.[/bg]',
    seekerVictimNotice: '\r\n[y]You hear a faint metallic thud...[/y]',
    terraformCollision: '[by:r]*** Warning ***: intersecting orbits detected![/by:r]',
    terraformDevicesRemaining: '  [by]Terraform devices remaining[/by]: [bc]{count}[/bc]',
    terraformFailure: '\r\n[br]{reason}[/br]',

    hyperspaceJump:
        '\r\n[bg]Hyperspace jump![/bg] Arrived in sector [bc]{sector}[/bc]. Fuel used: [by]{fuel}[/by], Turns: [by]{turns}[/by]',

    leftPlanet: '\r\n[y]You return to your ship and leave the planet.[/y]',
    noPlanetsToLand:
        "\r\n[g]There's no planet in this sector.[/g]" +
        '\r\n[g]You can create one with a terraform device.[/g]',

    towNoShips: '\r\n[bg]There are no ships in this sector to tow.[/bg]',
    towDisengaged: '\r\n[bc]You shut off your Tractor Beam.[/bc]',
    towMannedConfirm:
        '\r\n[by]Do you want to tow a manned ship?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [N][/mg] ',
    towMannedHeading:
        '\r\n                 [mg]--<[/mg]  [by]Manned Ships in Sector[/by] [mg]>--[/mg]',
    towUnmannedHeading:
        '\r\n                       [mg]--<[/mg] [by]Available ships in Sector ({sector})[/by] [mg]>--[/mg]',
    towMannedItemColored:
        '[bc]{index}-[/bc] [by]{name}[/by]{clanSuffix}[by],[/by] w/ [bc]{drones}[/bc] drones, in [by]{shipName}[/by] [mg]([/mg]{shipTypeColored}[mg])[/mg]',
    towMannedItemPlain:
        '[bc]{index}-[/bc] [by]{name}[/by]{clanSuffix}[by],[/by] w/ [bc]{drones}[/bc] drones, in [by]{shipName}[/by] [mg]([/mg][bc]{shipType}[/bc][mg])[/mg]',
    towUnmannedItemColored:
        '[bc]{index}-[/bc] [by]{shipName}[/by] [mg]([/mg]{shipTypeColored}[mg], [/mg]{ownership}[mg])[/mg] w/ [bc]{drones}[/bc] drones',
    towUnmannedItemPlain:
        '[bc]{index}-[/bc] [by]{shipName}[/by] [mg]([/mg][bc]{shipType}[/bc][mg], [/mg]{ownership}[mg])[/mg] w/ [bc]{drones}[/bc] drones',
    towClanSuffix: ' [mg][[/mg][bc]{num}[/bc][mg]][/mg]',
    towCannotMannedWithDrones: '\r\n[br]You cannot tow a manned ship that has fighters on it.[/br]',
    towSelectPrompt:
        '\r\n[by]Which ship do you want to tow?[/by] [mg]([/mg]1/.../[by]Q[/by][mg]) [Q][/mg] ',
    towEngaged:
        '\r\n[bc]{message}[/bc]\r\n [g]It will now cost you[/g] [by]{tpw}[/by] [g]turns for every sector you move.[/g]',
    towAttachError: '\r\n[br]{message}[/br]',
    towFreedFromTow: '[bc]You are released from the tractor beam as you leave the sector.[/bc]',
    towFreedByDock: '[bc]You are released from the tractor beam as you dock.[/bc]',
    towReleasedAlert: '\r\n[bc]{name} is no longer locked in tow.[/bc]',
    towAttachedAlert: '\r\n[bc]{name} locks a tractor beam on your ship.[/bc]',
    mailConnectHeader: '\r\n[bc]Searching for messages received since your last time on:[/bc]',
    mailNoneReceived: '[g]No messages received.[/g]',
    mailReadHeader: '\r\n[bc]<Read messages>[/bc]',
    mailReadEmpty: '[g]Your inbox is empty.[/g]',
    mailReceivedFromHeader: 'Received from [by]{name}[/by] at [by]{time}[/by]:',
    mailBodyLine: '> {line}',
    mailDeletePrompt:
        '\r\n[mg][Pause][/mg] [by]- Delete messages?[/by] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [N][/mg] ',
    hailWhoPrompt: '\r\n[by]Who do you want to send a message to?[/by]',
    hailNamePrompt: '[by]Which Trader ? (Full or Partial Name) - [/by]',
    hailRequesting: '\r\n[mg]Requesting comm-link with[/mg] [by]{name}[/by]',
    hailEstablished: '[bc]Secure comm-link established, Captain.[/bc]',
    hailNotResponding: '[mg]{name} is not responding, Captain.[/mg]',
    hailReroutingMail: '\r\n[mg]Rerouting message to Galactic M.A.I.L. Server.[/mg]',
    hailTypePrivateBanner:
        '\r\n[by]Type private message [<ENTER> to send line. Blank line to end transmission][/by]',
    hailTypeMailBanner:
        '\r\n[by]Type M.A.I.L. message [<ENTER> to send line. Blank line to end transmission][/by]',
    hailTerminated: '\r\n[bc]Secure comm-link terminated.[/bc]',
    hailQueued: '\r\n[bc]Message queued for delivery.[/bc]',
    hailEmpty: '[g]No message; comm-link aborted.[/g]',
    hailLinePromptOnline: '[by]P:[/by] ',
    hailLinePromptOffline: '[by]M:[/by] ',
    hailNotFound: '\r\n[br]No trader by that name.[/br]',
    hailAmbiguous: '\r\n[mg]Multiple matches:[/mg] [by]{matches}[/by]',
    hailSelf: '\r\n[mg]You cannot hail yourself, Captain.[/mg]',
    hailIncomingHeader: '\r\n[bc]<<< Incoming hail from[/bc] [by]{name}[/by] [bc]>>>[/bc]',
    hailIncomingBody: '[by]>[/by] {line}',
    clanMemoNotification: '\r\n[bc]You have a corporate memo from {name} in your inbox.[/bc]',
    clanMailServerEstablishing: '\r\n[mg]Establishing connection with Clan mail server.[/mg]',
    clanMemoTypeBanner:
        '\r\n[by]Type memo [<ENTER> to send line. Blank line to end transmission][/by]',
    clanMemoLinePrompt: '[by]M:[/by] ',
    noticeHeader: '\r\n[bc]Notice from[/bc] [by]{name}[/by][bc]:[/bc]',
    noticeBodyLine: '{line}',
    towedAlongManned: ' [bc]{name} enters the sector with you.[/bc]',
    towedAlongUnmanned: ' [bc]The {name} (ship) enters the sector with you.[/bc]',
    playerMovedTowedManned:
        '[bc] {towedName} (trader in tow) {verb} the sector with {moverName}.[/bc]',
    playerMovedTowedUnmanned:
        '[bc] The {towedName} (ship in tow) {verb} the sector with {moverName}.[/bc]',

    shipNamePromptInitial:
        '\r\n[bc]You have been issued a {type}.[/bc]\r\n[by]Name your ship[/by] [mg][[/mg][by]{default}[/by][mg]][/mg][by]: [/by]',
    shipNamePromptRespawn:
        '\r\n[bc]You have been issued a fresh {type}.[/bc]\r\n[by]Name your ship[/by] [mg][[/mg][by]{default}[/by][mg]][/mg][by]: [/by]',
    shipNamePromptBuyNew:
        '\r\n[by]Name your new {type}[/by] [mg][[/mg][by]{default}[/by][mg]][/mg][by]: [/by]',
    shipNamePromptTradein:
        '\r\n[by]Name your new {type}[/by] [mg][[/mg][by]{default}[/by][mg]][/mg][by]: [/by]',
    shipNameInvalid: '[br]{message}[/br]',

    expGained: '[g]You receive [by]{amount}[/by] experience point(s).[/g]',
    expLost: '[g]You lost [by]{amount}[/by] experience point(s).[/g]',
    alignmentUp: 'Your alignment went up by {amount} point(s) for {reason}.',
    alignmentDown: 'Your alignment went down by {amount} point(s) for {reason}.',
});
