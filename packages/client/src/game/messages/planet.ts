/**
 * Planet domain: landing, Earth, take/leave colonists, commodity selection,
 * planet-detail display, owned-planet list.
 */

import { makeDomain } from './_domain.js';

export const PLANET = makeDomain('PLANET', {
    landing: '[bg]Landing on[/bg] [bc]{name}[/bc][by]...[/by]',
    colonists: '  [by]Colonists[/by]: [bg]{count}[/bg]',

    prompt: '\r\n[mg]Planet command[/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]:[/by] ',

    earthHeader:
        '[mg]There are [/bg] [by]{count}[/by] colonists waiting on earth to colonize distant planets.\r\n' +
        "You can repurpose your ship's storage to house 1 colonist per cargo hold.",

    takePrompt:
        '\r\n[mg]How many colonists to take?[/mg] ([/mg][bc]{emptyHolds}[/bc] [g]free holds[/g][mg]) [[/mg][by]{emptyHolds}[/by][mg]][/mg] [by]:[/by] ',
    leavePrompt:
        '\r\n[by]How many colonists to leave?[/by] [mg]([/mg][bc]{shipColonists}[/bc] [g]on board[/g][mg])[/mg] [mg][[/mg][bc]{shipColonists}[/bc][mg]][/mg] ',

    loadUnloadBanner: '[bg]<Load/Unload Colonists>[/bg]',
    takeLeaveBanner: '[bg]<Take/Leave Products>[/bg]',
    changePopulationBanner: '[bg]<Change Colonist Population>[/bg]',
    displayPlanetPrompt:
        '\r\n[mg]Display planet?[/mg] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [[/mg][by]{default}[/by][mg]][/mg] [by]:[/by] ',
    leaveOrTakeColonistsPrompt:
        '[mg]([/mg][by]L[/by][mg])eave or ([/mg][by]T[/by][mg])ake Colonists?[/mg] [mg][[/mg][by]{default}[/by][mg]][/mg] [by]:[/by] ',
    leaveOrTakeProductPrompt:
        '[mg]([/mg][by]L[/by][mg])eave or ([/mg][by]T[/by][mg])ake Product?[/mg] [mg][[/mg][by]{default}[/by][mg]][/mg] [by]:[/by] ',
    productGroupTakingPrompt:
        '[mg]Which product are you taking?[/mg]\r\n[mg]([/mg][by]1[/by][mg])Ore, ([/mg][by]2[/by][mg])Org or ([/mg][by]3[/by][mg])Equipment?[/mg] ',
    productGroupLeavingPrompt:
        '[mg]Which product are you leaving?[/mg]\r\n[mg]([/mg][by]1[/by][mg])Ore, ([/mg][by]2[/by][mg])Org or ([/mg][by]3[/by][mg])Equipment?[/mg] ',
    colonistGroupChangingPrompt:
        '[mg]Which production group are you changing?[/mg]\r\n[mg]([/mg][by]1[/by][mg])Ore, ([/mg][by]2[/by][mg])Org or ([/mg][by]3[/by][mg])Equipment Production?[/mg] ',
    colonistGroupFromPrompt:
        '[mg]Which production group are you moving Colonists from?[/mg]\r\n[mg]([/mg][by]1[/by][mg])Ore, ([/mg][by]2[/by][mg])Org or ([/mg][by]3[/by][mg])Equipment?[/mg] ',
    colonistGroupToPrompt:
        '[mg]And which group are you moving them to?[/mg]\r\n[mg]([/mg][by]1[/by][mg])Ore, ([/mg][by]2[/by][mg])Org or ([/mg][by]3[/by][mg])Equipment?[/mg] ',
    productQtyTakePrompt:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to take ([/mg][by][{emptyHolds}][/by] [mg]empty holds) ?[/mg] ',
    productQtyLeavePrompt:
        '[mg]How many holds of[/mg] [bc]{commodity}[/bc] [mg]do you want to leave ([/mg][by][{onBoard}][/by] [mg]on board[/mg][mg]) ?[/mg] ',
    colonistQtyTakePrompt:
        '[mg]How many groups of Colonists do you want to take ([/mg][by][{emptyHolds}][/by] [mg]empty holds) ?[/mg] ',
    colonistQtyLeavePrompt:
        '[mg]How many groups of Colonists do you want to leave ([/mg][by][{shipColonists}][/by] [mg]on board) ?[/mg] ',
    populationQtyPrompt:
        '[mg]How many groups of Colonists do you want to move?[/mg] ',
    colonistsLoaded: '[bg]The Colonists file aboard your ship, eager to head out.[/bg]',
    colonistsUnloaded: '[bg]The Colonists settle in to their new homes on the planet.[/bg]',
    productLoaded: '[bg]You load the {commodity} aboard your ship.[/bg]',
    productUnloaded: '[bg]You unload the {commodity} from your ship.[/bg]',
    notThatMany: '[br]There aren\'t that many on the planet![/br]',
    notThatMuchOnShip: '[br]You don\'t have that many on board![/br]',
    populationMoved: '[bg]The Colonists drop what they were doing and start their new jobs.[/bg]',
    sameGroup: '[br]That\'s the same group.[/br]',

    takeCommodityHeader: '[bc]Which colonists to take?[/bc]',
    leaveCommodityHeader: '[bc]Assign colonists to which commodity?[/bc]',
    commodityPrompt:
        '\r\n[mg]Choose[/mg] [mg]([/mg][by]F[/by]/[by]O[/by]/[by]E[/by]/[by]D[/by]/[by]Q[/by][mg])[/mg] [by]?[/by] ',
    takeStockpileHeader: '[bc]Which commodity to take from the planet?[/bc]',
    leaveStockpileHeader: '[bc]Which commodity to leave on the planet?[/bc]',
    takeStockpileQtyPrompt:
        '\r\n[mg]How many[/mg] [bc]{commodity}[/bc] [mg]to take?[/mg] [mg][[/mg][by]{default}[/by][mg]][/mg] [by]:[/by] ',
    leaveStockpileQtyPrompt:
        '\r\n[mg]How many[/mg] [bc]{commodity}[/bc] [mg]to leave?[/mg] [mg][[/mg][by]{default}[/by][mg]][/mg] [by]:[/by] ',
    takeStockpileResult:
        '[bg]Took [bc]{qty}[/bc] {commodity}.[/bg]  [g]Planet[/g]: [by]{planet}[/by]  [g]Ship[/g]: [by]{ship}[/by]',
    leaveStockpileResult:
        '[bg]Left [bc]{qty}[/bc] {commodity}.[/bg]  [g]Planet[/g]: [by]{planet}[/by]  [g]Ship[/g]: [by]{ship}[/by]',

    planetSelectHeader: '[by]Registry# Planet Name[/by]',
    planetSelectSep: '[g]-----------------------------------------------[/g]',
    planetSelectRow: '   [mg]<[/mg][by]{n}[/by][mg]>[/mg]  [bc]{name}[/bc]',
    planetSelectPrompt:
        '\r\n[mg]Land on which planet[/mg] [mg]<[/mg][by]Q[/by] [mg]to abort> ?[/mg] ',

    takeColonistsHeader: '[bg]You took [bc]{qty}[/bc] colonists.[/bg]',
    leaveColonistsHeader: '[bg]You left [bc]{qty}[/bc] colonists.[/bg]',
    planetColonistsLine: '  [g]There are [by]{count}[/by] colonists remaining on the planet.[/g]',
    shipColonistsLine:
        '  [g]Your holds  [by]{count}[/by] holds occupied by camping colonists.[/g]: ',

    landedHeader: '[bg]Landed on[/bg] [bc]{name}[/bc]',

    displayTitle: '[bc]Planet #{id}[/bc] in sector [by]{sector}[/by]:  [bg]{name}[/bg]',
    displayClass: '[mg]Class[/mg]: {type}',
    displayOwner: '[mg]Owner[/mg]: [w]{owner}[/w]',
    displayTableHead1:
        '  [by]Item[/by]    [by]Colonists[/by]   [by]Colos to[/by]   [by]Hourly[/by]     [by]Planet[/by]     [by]Ship[/by]       [by]Planet[/by]',
    displayTableHead2:
        '                      [by]Build 1/h[/by]  [by]Product[/by]    [by]Amount[/by]     [by]Amount[/by]     [by]Maximum[/by]',
    displayTableSep:
        ' [g]-------- ----------  ---------  ---------  ---------  --------- ---------[/g]',
    displayTableRow:
        '[w]{item}[/w]  [bc]{colos}[/bc]  [c]{c2b1}[/c]  [bc]{hourly}[/bc]  [bc]{planet}[/bc]  [bc]{ship}[/bc]  [c]{max}[/c]',
    displayHolds: '\r\n[g]You have[/g] [bc]{holds}[/bc] [g]free cargo holds.[/g]',

    listEmpty: '[br]You own no planets.[/br]',
    listHeader: '[bc]=== Your Planets ===[/bc]',
    listRow: '  [by]Sector {sector}[/by] — [bc]{name}[/bc] ({type})',
    listColonists:
        '  Colonists: {{MSG.fuelQuantity}}, {{MSG.orgQuantity}}, {{MSG.equQuantity}}',

    claimOwnershipPrompt:
        '\r\n[mg]Claim as ([/mg][by]P[/by][mg]ersonal, [/mg][by]C[/by][mg]lan, [/mg][by]Q[/by][mg]) [/mg][by]?[/by] ',
    claimSuccessPersonal: '\r\n[bg]Planet [/bg][bc]{name}[/bc] [bg]is now yours.[/bg]',
    claimSuccessClan: '\r\n[bg]Planet [/bg][bc]{name}[/bc] [bg]is now clan-owned.[/bg]',

    // Planetary Defense Bastion ("base") prompts.
    baseIntro1:
        '[w]This planet does not have a planetary defense bastion (base). You may construct one,[/w]',
    baseIntro2:
        '[w]given sufficient materials and manpower.[/w]',
    baseIntro3:
        '[w]Once constructed, a base provides a relatively safe refuge for your clanmates and[/w]\r\n' +
        '[w]belongings from the dangers of open space.[/w]',
    baseIntro4:
        '[w]Once constructed, a base provides a hangar to store ships, living quarters, a treasury,[/w]\r\n' +
        '[w]and a transporter pad. It may be subsequently upgraded to provide various defensive[/w]\r\n' +
        '[w]functions such as drone combat control, atmospheric and sector cannons, shielding,[/w]\r\n' +
        '[w]powerful tractor beam technology, and even planetary warp.[/w]',
    baseRequirementsHeader:
        '[bc]Constructing a level 1 base on a class [/bc][by]{planetClass}[/by][bc] ([/bc]{planetType}[bc]) planet requires:[/bc]',
    baseRequirementsLine:
        '  [by]{label}[/by]  need [bc]{need}[/bc]  have [bc]{have}[/bc]  {status}',
    baseRequirementsDays:
        '  [by]Construction time[/by]: [bc]{days}[/bc] day(s)',
    baseConstructPrompt:
        '\r\n[bc]Construct a level 1 base?[/bc] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [[/mg][by]N[/by][mg]] [/mg]',
    baseConstructionStarted:
        '[bg]Construction of your level [/bg][bc]{level}[/bc][bg] base has begun. It will take [/bg][bc]{days}[/bc][bg] day(s).[/bg]\r\n' +
        '  [by]Expected completion[/by]: [bc]{completes}[/bc]',
    baseConstructing:
        '[bc]Base level [/bc][bc]{level}[/bc][bc] construction in progress.[/bc]\r\n' +
        '  [by]Started[/by]: [bc]{started}[/bc]\r\n' +
        '  [by]Completes[/by]: [bc]{completes}[/bc]  [g]([/g][bc]{hours}[/bc][g] hours remaining)[/g]',
    baseShortfall: '  [br]Short[/br]: [w]{items}[/w]',
    baseError: '[br]Base error[/br]: [w]{message}[/w]',
    baseEntered: '[bg]Entered base (level [/bg][bc]{level}[/bc][bg]).[/bg]',
    basePrompt:
        '\r\n[mg]Base command[/mg] [mg][[/mg][bc]{sector}[/bc][mg]][/mg] [mg]([/mg][by]?[/by]=[by]Help[/by][mg])[/mg] [by]:[/by] ',
    displayBaseSummary:
        '[bc]This planet has a level [/bc][by]{level}[/by][bc] base. The treasury contains [/bc][by]{treasury}[/by][bc] credits.[/bc]',
    displayBaseConstructing:
        '[bc]A level [/bc][by]{level}[/by][bc] base is under construction here. Completes at [/bc][by]{completes}[/by][bc] ([/bc][by]{hours}[/by][bc] hour(s) remaining).[/bc]',
    displayTransporterLine:
        '     [mg]-=-=-=-=-=-[/mg] [bc]TransPort power = [/bc][by]{hops}[/by][bc] hops[/bc] [mg]-=-=-=-=-=-[/mg]',
    treasuryDirectionPrompt:
        '\r\n[mg]Transfer ([/mg][by]T[/by][mg]o or [/mg][by]F[/by][mg]rom treasury, [/mg][by]Q[/by][mg] to cancel) [/mg][by]?[/by] ',
    treasuryBalances:
        '\r\n[bc]Credits on hand[/bc]: [by]{credits}[/by]\r\n[bc]Treasury balance[/bc]: [by]{treasury}[/by]',
    treasuryAmountPrompt:
        '[mg]Amount to transfer ([/mg][by]Q[/by][mg] to cancel) [/mg][by]:[/by] ',
    treasuryTransferOk:
        '\r\n[bg]Transferred [/bg][bc]{amount}[/bc][bg] credits {direction} the treasury.[/bg]\r\n' +
        '[bc]Credits on hand[/bc]: [by]{credits}[/by]\r\n[bc]Treasury balance[/bc]: [by]{treasury}[/by]',
    treasuryError: '[br]Treasury error[/br]: [w]{message}[/w]',

    // Planetary Transporter ("bwarp") flow.
    bwarpNotInstalledIntro:
        '\r\n[w]This Planetary Bastion does not have a transporter installed. You can order one[/w]\r\n' +
        '[w]for [/w][by]{cost}[/by][w] credits and have it installed immediately.[/w]',
    bwarpInstallPrompt:
        '\r\n[bc]Order a planetary transporter?[/bc] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [[/mg][by]N[/by][mg]] [/mg]',
    bwarpInstallFlavor:
        '\r\n[w]You send a subspace message to the Transport-o-Matic Transporter company along with[/w]\r\n' +
        '[w]your payment, and the planet\'s transponder address and credentials. Seconds later,[/w]\r\n' +
        '[w]a huge rectangular but otherwise nondescript spacecraft materializes in the sector[/w]\r\n' +
        '[w]and quickly lands. The top of the ship opens up and a small fleet of drones lifts out,[/w]\r\n' +
        '[w]collectively carrying the transporter device. An army of robots hook it up to the[/w]\r\n' +
        '[w]planet\'s fuel storage and installs the transporter pad in the center of your hangar.[/w]\r\n' +
        '[w]Before you know it, the job is done. The conveyor drones all take stations in[/w]\r\n' +
        '[w]designated alcoves of the transporter pad housing as the robots return to their ship[/w]\r\n' +
        '[w]and are gone as quickly as they arrived.[/w]\r\n' +
        '\r\n[bg]The transporter is installed with a range of [/bg][bc]{range}[/bc][bg] hop(s).[/bg]\r\n' +
        '[by]{cost}[/by][bg] credits have been deducted from your personal funds.[/bg]',
    bwarpInstalledIntro:
        '\r\n[w]The conveyor drones position your ship on the immense transporter pad as the huge[/w]\r\n' +
        '[w]transference generators power up.[/w]',
    bwarpRangeLine:
        '\r\n[bc]This transporter has a range of [/bc][by]{range}[/by][bc] hop(s).[/bc]',
    bwarpBeamPrompt:
        '[mg]Beam to what sector? ([/mg][by]U[/by]=[by]Upgrade[/by] [by]Q[/by]=[by]Quit[/by][mg]) [/mg]',
    bwarpUpgradePitch:
        '\r\n[bc]The cost for a field upgrade to this transporter is [/bc][by]{cost}[/by][bc].[/bc]\r\n' +
        '[bc]Each upgrade will increase the range by one sector.[/bc]',
    bwarpUpgradePrompt:
        '\r\n[bc]Do you want to upgrade this transporter?[/bc] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [[/mg][by]N[/by][mg]] [/mg]',
    bwarpUpgradeFlavor:
        '\r\n[w]You send an upgrade order for a Planetary Transporter to Transport-o-Matic and even[/w]\r\n' +
        '[w]faster than the original purchase, the upgrade is installed.[/w]\r\n' +
        '\r\n[by]{cost}[/by][bg] credits have been deducted from your personal funds.[/bg]\r\n' +
        '[bc]Bastion treasury contains [/bc][by]{treasury}[/by][bc] credits.[/bc]\r\n' +
        '[bc]New transporter range: [/bc][by]{range}[/by][bc] hop(s).[/bc]',
    bwarpDistanceLine:
        '[bc]Sector [/bc][by]{sector}[/by][bc] is [/bc][by]{hops}[/by][bc] hop(s) away from here.[/bc]',
    bwarpOutOfRange:
        '[br]Target out of range[/br] [w](have [/w][by]{range}[/by][w] hops, need [/w][by]{hops}[/by][w]).[/w]',
    bwarpFuelCheck:
        '[bc]Beam cost: [/bc][by]{fuelCost}[/by][bc] fuel ore (planet stock: [/bc][by]{planetFuel}[/by][bc]).[/bc]',
    bwarpInsufficientFuel:
        '[br]Insufficient planet fuel[/br] [w]for this jump.[/w]',
    bwarpEngagePrompt:
        '\r\n[w]Federation beacon acknowledged, coordinates cleared for beaming.[/w]\r\n' +
        '[w]Locating beam pinpointed, TransWarp Locked.[/w]\r\n' +
        '[bc]All Systems Ready, shall we engage?[/bc] [mg]([/mg][by]Y[/by]/[by]N[/by][mg]) [[/mg][by]Y[/by][mg]] [/mg]',
    bwarpBeamedFlavor:
        '\r\n[bg]Beamed to sector [/bg][bc]{sector}[/bc][bg] ([/bg][bc]{hops}[/bc][bg] hop(s)).[/bg]\r\n' +
        '[by]{fuelUsed}[/by][bg] fuel ore consumed from planet stock.[/bg]',
    bwarpError: '[br]Transporter error[/br]: [w]{message}[/w]',
});
