import { ServerMsgType, ClientMsgType } from '@twnr/shared';
import type { ServerResult } from '@twnr/shared';
import type { GameContext } from './types.js';

import { showSectorDisplay, showDockedMenu, showPrompt } from './display.js';
import { showClass0Menu, showAutopilotPrompt } from './display-port.js';
import { showPlanetMenu, showPlanetMenuOptions, showEarthMenu, showNoPlanet } from './display-planet.js';
import { showDroneEncounter } from './display-combat.js';
import { showStarbaseMenu, showHardwareMenu, showPlanetSelectMenu } from './display-starbase.js';
import { renderVisitedSectorsResult, showComputerPrompt } from './display-computer.js';
import { colors } from './constants.js';

const mg = colors.magenta;

export function setupConnection(ws: WebSocket, ctx: GameContext) {
    ws.addEventListener('open', () => {
        ctx.term.writeln(colors.green('Connected to TWNR.'));
    });

    ws.addEventListener('message', (event) => {
        const raw = JSON.parse(event.data);
        if (ctx.debug) {
            const lines = JSON.stringify(raw, null, 2).split('\n');
            ctx.term.writeln(`\r\n\x1b[38;5;243m← ${lines[0]}\x1b[0m`);
            for (let i = 1; i < lines.length; i++) {
                ctx.term.writeln(`\x1b[38;5;243m  ${lines[i]}\x1b[0m`);
            }
        }
        // Support envelope format: { menu, payload } or legacy bare messages
        const msg: ServerResult = raw.payload ?? raw;
        if (raw.menu) {
            // Server is authoritative on menu state
            ctx.setMode(raw.menu);
        }
        switch (msg.type) {
            case ServerMsgType.Welcome:
                ctx.setPlayerName(msg.name);
                ctx.setPlayerId(msg.playerId);
                ctx.setTotalSectors(msg.totalSectors);
                ctx.setCurrentShipName(msg.shipName);
                ctx.setStarbaseSector(msg.starbaseSector);
                ctx.term.writeln(`\r\n${colors.boldGreen(`Welcome, ${msg.name}.`)}`);
                ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case ServerMsgType.PlayerMoved:
                if (msg.direction === 'in') {
                    ctx.term.writeln(`\r\n${colors.boldYellow('Player warped into the sector.')}`);
                } else {
                    ctx.term.writeln(`\r\n${colors.white('Player warped out of the sector.')}`);
                }
                break;
            case ServerMsgType.SectorDisplayResult:
                ctx.setSectorPlayers(msg.players);
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.sectorDrones,
                    msg.planets,
                    msg.collisions,
                );
                // Advance autopilot if in progress
                if (ctx.autopilotPath.length > 0 && ctx.autopilotStep < ctx.autopilotPath.length) {
                    const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                    ctx.setAutopilotStep(ctx.autopilotStep + 1);
                    ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                } else if (ctx.autopilotPath.length > 0) {
                    // Arrived at destination
                    ctx.setAutopilotPath([]);
                    ctx.setAutopilotStep(0);
                }
                break;
            case ServerMsgType.DockResult:
                if (msg.docked && msg.port) {
                    ctx.setDockedPortInfo(msg.port);
                    if (msg.port.class === 0) {
                        showClass0Menu(ctx);
                    } else {
                        showDockedMenu(ctx);
                    }
                }
                break;
            case ServerMsgType.UndockResult:
                if (msg.outcome === 'success') {
                    ctx.setDockedPortInfo(null);
                    ctx.term.writeln(`\r\n${colors.white('You undock from the port.')}`);
                    ctx.setSectorPlayers(msg.players);
                    showSectorDisplay(
                        ctx,
                        msg.sector,
                        msg.warps,
                        msg.players,
                        msg.port,
                        msg.sectorDrones,
                        msg.planets,
                        msg.collisions,
                    );
                } else {
                    ctx.term.writeln(`\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`);
                }
                break;
            case ServerMsgType.JettisonResult:
                if (msg.outcome === 'success') {
                    const j = msg.jettisoned;
                    const items = [
                        j.fuel > 0 ? `${j.fuel} fuel` : '',
                        j.organics > 0 ? `${j.organics} organics` : '',
                        j.equipment > 0 ? `${j.equipment} equipment` : '',
                        j.colonists > 0 ? `${j.colonists} colonists` : '',
                    ]
                        .filter(Boolean)
                        .join(', ');
                    ctx.term.writeln(
                        `\r\n${colors.boldYellow('Jettisoned:')} ${items || 'nothing'}`,
                    );
                } else {
                    ctx.term.writeln(`\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`);
                }
                ctx.setMode('sector');
                showPrompt(ctx);
                break;
            case ServerMsgType.PortTransactionResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Transaction complete.')} Credits: ${colors.boldYellow(String(msg.credits))}`,
                );
                ctx.term.writeln(
                    `  Cargo — ${colors.boldYellow('Fuel')}: ${msg.cargo.fuel}, ${colors.boldYellow('Organics')}: ${msg.cargo.organics}, ${colors.boldYellow('Equipment')}: ${msg.cargo.equipment}, ${colors.boldYellow('Colonists')}: ${msg.cargo.colonists}`,
                );
                if (ctx.mode === 'docked') showDockedMenu(ctx);
                break;
            case ServerMsgType.ShipInfoResult:
                ctx.setCurrentShipName(msg.shipName);
                ctx.term.writeln('');
                ctx.term.writeln(`${colors.white('Ship:')} ${colors.boldCyan(msg.shipName)}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Drones')}: ${colors.white(`${msg.drones}`)}/${colors.cyan(`${msg.maxDrones}`)}  ${colors.boldYellow('Shields')}: ${colors.white(`${msg.shields}`)}/${colors.cyan(`${msg.maxShields}`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Cargo holds')}: ${colors.boldGreen(`${msg.holdsAvailable} free`)} / ${colors.white(`${msg.cargoLimit} total`)} ${mg('(')}max ${msg.maxHolds}${mg(')')}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Fuel')}: ${msg.cargoFuel}  ${colors.boldYellow('Organics')}: ${msg.cargoOrganics}  ${colors.boldYellow('Equipment')}: ${msg.cargoEquipment}  ${colors.boldYellow('Colonists')}: ${msg.cargoColonists}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${colors.boldYellow(String(msg.credits))}`,
                );
                if (ctx.mode === 'sector') showPrompt(ctx);
                break;
            case ServerMsgType.CargoInfoResult:
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${colors.boldYellow(String(msg.credits))}`,
                );
                break;
            case ServerMsgType.PlayersOnlineResult: {
                ctx.term.writeln('');
                ctx.term.writeln(`${colors.boldCyan('Players Online')} (${msg.players.length}):`);
                for (const p of msg.players) {
                    const tag = p.id === ctx.playerId ? colors.boldGreen(' (you)') : '';
                    ctx.term.writeln(`  ${colors.boldYellow(p.name)}${tag}`);
                }
                showPrompt(ctx);
                break;
            }
            case ServerMsgType.MoveResult:
                switch (msg.outcome) {
                    case 'success':
                        ctx.setSectorPlayers(msg.players);
                        showSectorDisplay(
                            ctx,
                            msg.sector,
                            msg.warps,
                            msg.players,
                            msg.port,
                            msg.sectorDrones,
                            msg.planets,
                            msg.collisions,
                        );
                        if (
                            ctx.autopilotPath.length > 0 &&
                            ctx.autopilotStep < ctx.autopilotPath.length
                        ) {
                            const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                            ctx.setAutopilotStep(ctx.autopilotStep + 1);
                            ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
                        } else if (ctx.autopilotPath.length > 0) {
                            ctx.setAutopilotPath([]);
                            ctx.setAutopilotStep(0);
                        }
                        break;
                    case 'encounter': {
                        ctx.setSectorPlayers(msg.players);
                        ctx.visitedSet.add(msg.sector);
                        ctx.setCurrentSector(msg.sector);
                        ctx.setCurrentPort(msg.port ?? null);
                        ctx.setEncounterOwnerName(msg.ownerName);
                        showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
                        if (ctx.autopilotPath.length > 0) {
                            ctx.setAutopilotPaused(true);
                            ctx.term.writeln(
                                `\r\n${colors.boldRed('Autopilot disengaged — hostile drones!')}`,
                            );
                        }
                        showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
                        break;
                    }
                    case 'nonAdjacent':
                        ctx.sendMsg({
                            type: ClientMsgType.ShortestPath,
                            from: ctx.currentSector,
                            to: msg.sector,
                        });
                        break;
                    case 'noShip':
                        ctx.term.writeln(`\r\n${colors.boldRed('You do not have a ship.')}`);
                        showPrompt(ctx);
                        break;
                    case 'error':
                        ctx.term.writeln(
                            `\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`,
                        );
                        showPrompt(ctx);
                        break;
                }
                break;
            case ServerMsgType.NonAdjacentMoveRequested:
                // Legacy — kept for backwards compatibility during refactor
                ctx.sendMsg({
                    type: ClientMsgType.ShortestPath,
                    from: ctx.currentSector,
                    to: msg.sector,
                });
                break;
            case ServerMsgType.ShortestPathResult:
                if (msg.path.length > 1) {
                    showAutopilotPrompt(ctx, msg.path, msg.hops);
                } else {
                    ctx.term.writeln(`\r\n${colors.boldRed('No path found to that sector.')}`);
                    showPrompt(ctx);
                }
                break;
            case ServerMsgType.BuyDronesResult:
                ctx.term.writeln(`\r\n${colors.boldGreen('Purchase complete.')}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${msg.credits}  ${colors.boldYellow('Drones')}: ${msg.drones}`,
                );
                if (ctx.mode === 'class0Qty') {
                    ctx.setMode('class0');
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.BuyShieldsResult:
                ctx.term.writeln(`\r\n${colors.boldGreen('Purchase complete.')}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${msg.credits}  ${colors.boldYellow('Shields')}: ${msg.shields}`,
                );
                if (ctx.mode === 'class0Qty') {
                    ctx.setMode('class0');
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.BuyHoldsResult:
                ctx.term.writeln(`\r\n${colors.boldGreen('Purchase complete.')}`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Credits')}: ${msg.credits}  ${colors.boldYellow('Holds')}: ${msg.cargoLimit}`,
                );
                if (ctx.mode === 'class0Qty') {
                    ctx.setMode('class0');
                    showClass0Menu(ctx);
                }
                break;
            case ServerMsgType.AttackShipResult:
                ctx.term.writeln('');
                if (msg.destroyed) {
                    ctx.term.writeln(colors.boldRed(msg.message || 'Target destroyed!'));
                } else {
                    ctx.term.writeln(colors.boldYellow(msg.message || 'Attack completed.'));
                }
                ctx.term.writeln(
                    `  ${colors.boldYellow('Your drones lost')}: ${msg.attackerDronesLost}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Defender shields lost')}: ${msg.defenderShieldsLost}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Defender drones lost')}: ${msg.defenderDronesLost}`,
                );
                showPrompt(ctx);
                break;
            case ServerMsgType.BuyShipTradeinResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Ship exchanged!')} Now flying: ${colors.boldCyan(msg.shipName)}`,
                );
                ctx.term.writeln(`  ${colors.boldYellow('Credits')}: ${msg.credits}`);
                if (ctx.mode === 'docked') showDockedMenu(ctx);
                break;
            case ServerMsgType.PlanetInfoResult:
                if (msg.hasPlanet) {
                    showPlanetMenu(ctx, msg.name, msg.colonists);
                } else {
                    showNoPlanet(ctx);
                }
                break;
            case ServerMsgType.TakeColonistsResult: {
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldGreen(`You took ${msg.quantity.toLocaleString()} ${msg.commodity} colonists.`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Planet colonists')}: ${colors.white(msg.planetColonists.toLocaleString())}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Ship colonists')}: ${colors.white(String(msg.shipColonists))}`,
                );
                break;
            }
            case ServerMsgType.LeaveColonistsResult: {
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldGreen(`You left ${msg.quantity.toLocaleString()} ${msg.commodity} colonists.`)}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Planet colonists')}: ${colors.white(msg.planetColonists.toLocaleString())}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Ship colonists')}: ${colors.white(String(msg.shipColonists))}`,
                );
                break;
            }
            case ServerMsgType.DroneEncounter: {
                ctx.setSectorPlayers(msg.players);
                ctx.visitedSet.add(msg.sector);
                ctx.setCurrentSector(msg.sector);
                ctx.setCurrentPort(msg.port ?? null);
                ctx.setEncounterOwnerName(msg.ownerName);

                // Show sector info first
                showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);

                if (ctx.autopilotPath.length > 0) {
                    ctx.setAutopilotPaused(true);
                    ctx.term.writeln(
                        `\r\n${colors.boldRed('Autopilot disengaged — hostile drones!')}`,
                    );
                }

                showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
                break;
            }
            case ServerMsgType.DeployDronesInfoResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldYellow('Deploy Drones')} — Sector: ${colors.white(String(msg.sectorDrones))}, Ship: ${colors.white(String(msg.shipDrones))}/${colors.cyan(String(msg.shipMaxDrones))}`,
                );
                ctx.term.write(
                    `${colors.cyan('How many drones to leave in sector?')} ${colors.white('(Q to cancel)')} `,
                );
                break;
            case ServerMsgType.DeployDronesResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Deployed.')} Sector: ${colors.white(String(msg.sectorDrones))}, Ship: ${colors.white(String(msg.shipDrones))}`,
                );
                showPrompt(ctx);
                break;
            case ServerMsgType.AttackSectorDronesResult:
                ctx.term.writeln('');
                ctx.term.writeln(
                    `${colors.boldYellow('Combat:')} Lost ${colors.boldRed(String(msg.dronesLost))} drones. Sector drones remaining: ${colors.boldRed(String(msg.sectorDronesRemaining))}. Ship drones: ${colors.white(String(msg.shipDrones))}`,
                );
                if (msg.victory) {
                    ctx.term.writeln(colors.boldGreen('Sector cleared!'));
                    if (ctx.autopilotPaused) {
                        ctx.term.writeln(colors.boldCyan('Autopilot resuming...'));
                        ctx.setAutopilotPaused(false);
                        // Server will send SectorDisplay which triggers autopilot advance
                        ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                    } else {
                        showPrompt(ctx);
                    }
                } else {
                    // Re-show encounter with updated numbers
                    showDroneEncounter(
                        ctx,
                        msg.sectorDronesRemaining,
                        ctx.encounterOwnerName,
                        msg.shipDrones,
                    );
                }
                break;
            case ServerMsgType.RetreatFromDronesResult:
                ctx.term.writeln(
                    `\r\n${colors.boldYellow('Retreated to sector')} ${colors.boldCyan(String(msg.sector))}`,
                );
                if (ctx.autopilotPaused) {
                    ctx.setAutopilotPath([]);
                    ctx.setAutopilotStep(0);
                    ctx.setAutopilotPaused(false);
                    ctx.term.writeln(colors.boldRed('Autopilot cancelled.'));
                }
                // SectorDisplay follows from server
                break;
            case ServerMsgType.SectorDronesAlert:
                ctx.term.writeln('');
                if (msg.event === 'intrusion') {
                    ctx.term.writeln(
                        `${colors.boldYellow('Alert:')} ${colors.boldRed(msg.intruderName)} entered sector ${colors.boldCyan(String(msg.sector))} with your drones!`,
                    );
                } else if (msg.event === 'attacked') {
                    ctx.term.writeln(
                        `${colors.boldRed('Alert:')} ${colors.boldRed(msg.intruderName)} attacked your drones in sector ${colors.boldCyan(String(msg.sector))}! Lost: ${msg.dronesLost}, remaining: ${msg.dronesRemaining}`,
                    );
                } else if (msg.event === 'destroyed') {
                    ctx.term.writeln(
                        `${colors.boldRed('Alert:')} ${colors.boldRed(msg.intruderName)} destroyed all your drones in sector ${colors.boldCyan(String(msg.sector))}!`,
                    );
                }
                break;
            case ServerMsgType.DockStarbaseResult:
                ctx.setHardwarePrices(msg.prices);
                showStarbaseMenu(ctx);
                break;
            case ServerMsgType.LeaveStarbaseResult:
                ctx.setSectorPlayers(msg.players);
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.sectorDrones,
                    msg.planets,
                    msg.collisions,
                );
                break;
            case ServerMsgType.LandResult:
                if (msg.planets.length > 0) {
                    (ctx as any).landablePlanets = msg.planets;
                    showPlanetSelectMenu(ctx, msg.planets);
                } else {
                    ctx.term.writeln(`\r\n${colors.white('No planets in this sector.')}`);
                    showPrompt(ctx);
                }
                break;
            case ServerMsgType.LandOnPlanetResult:
                if (ctx.mode === 'planetEarth') {
                    showEarthMenu(ctx, msg.colonists_fuel ?? 0);
                } else {
                    ctx.term.writeln('');
                    ctx.term.writeln(`${colors.boldGreen('Landed on')} ${colors.boldCyan(msg.name)}`);
                    ctx.term.writeln(`  ${colors.boldYellow('Type')}: ${msg.planetType}`);
                    ctx.term.writeln(
                        `  ${colors.boldYellow('Drones')}: ${msg.drones}  ${colors.boldYellow('Fuel')}: ${msg.fuel}  ${colors.boldYellow('Organics')}: ${msg.organics}  ${colors.boldYellow('Equipment')}: ${msg.equipment}`,
                    );
                    ctx.term.writeln(
                        `  ${colors.boldYellow('Colonists')}: Fuel=${msg.colonists_fuel ?? 0}, Org=${msg.colonists_organics ?? 0}, Equ=${msg.colonists_equipment ?? 0}`,
                    );
                    showPlanetMenuOptions(ctx);
                }
                break;
            case ServerMsgType.PlanetDisplayResult:
                ctx.term.writeln('');
                ctx.term.writeln(`${colors.boldCyan(msg.name)} (${msg.planetType})`);
                ctx.term.writeln(
                    `  ${colors.boldYellow('Drones')}: ${msg.drones}  ${colors.boldYellow('Fuel')}: ${msg.fuel}  ${colors.boldYellow('Organics')}: ${msg.organics}  ${colors.boldYellow('Equipment')}: ${msg.equipment}`,
                );
                ctx.term.writeln(
                    `  ${colors.boldYellow('Colonists')}: Fuel=${msg.colonists_fuel}, Org=${msg.colonists_organics}, Equ=${msg.colonists_equipment}`,
                );
                break;
            case ServerMsgType.DestroyPlanetResult:
                if (msg.destroyed) {
                    ctx.term.writeln(
                        `\r\n${colors.boldRed(`Planet ${msg.planetName} destroyed!`)}`,
                    );
                }
                showPrompt(ctx);
                break;
            case ServerMsgType.UseTerraformDeviceResult:
                if (msg.success && msg.planet) {
                    ctx.term.writeln(
                        `\r\n${colors.boldGreen('Terraform successful!')} Created ${colors.boldCyan(msg.planet.name)} (${msg.planet.type})`,
                    );
                    if (msg.collision)
                        ctx.term.writeln(
                            colors.boldYellow('Warning: planetary collision detected!'),
                        );
                    ctx.term.writeln(
                        `  ${colors.boldYellow('Terraform devices remaining')}: ${msg.terraformDevices}`,
                    );
                } else {
                    const reason =
                        msg.reason === 'no_devices'
                            ? 'No terraform devices on ship.'
                            : msg.reason === 'restricted_sector'
                              ? 'Cannot terraform in this sector.'
                              : 'Terraform failed.';
                    ctx.term.writeln(`\r\n${colors.boldRed(reason)}`);
                }
                showPrompt(ctx);
                break;
            case ServerMsgType.BuyPlanetBustersResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Planet Busters: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyTerraformDevicesResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Terraform Devices: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyHyperwarpDriveResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Hyperwarp drive installed!')} Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyBuoysResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Space Buoys: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyMinesResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} ${msg.mineType} mines: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyMineDisruptorsResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Mine Disruptors: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyVisualScannerResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Visual Scanner installed!')} Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyPlanetScannerResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Planet Scanner installed!')} Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyCloakingDeviceResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Cloaking Devices: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyCorbomiteResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Corbomite: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyPhotonTorpedoesResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Photon Torpedoes: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyReconDronesResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Purchase complete.')} Recon Drones: ${msg.totalOnShip}, Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.BuyHyperspaceDriveResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen(`Hyperspace Drive Type ${msg.driveType} installed!`)} Credits: ${msg.credits}`,
                );
                showHardwareMenu(ctx);
                break;
            case ServerMsgType.ListDeployedDronesResult:
                ctx.term.writeln('');
                if (msg.drones.length === 0) {
                    ctx.term.writeln(colors.white('No drones deployed.'));
                } else {
                    ctx.term.writeln(colors.boldCyan('Deployed Drones:'));
                    for (const d of msg.drones) {
                        ctx.term.writeln(
                            `  Sector ${colors.boldYellow(String(d.sectorId))}: ${colors.white(String(d.quantity))} drones`,
                        );
                    }
                }
                showPrompt(ctx);
                break;
            case ServerMsgType.HyperspaceJumpResult:
                ctx.term.writeln(
                    `\r\n${colors.boldGreen('Hyperspace jump!')} Arrived at sector ${colors.boldCyan(String(msg.targetSector))}. Fuel used: ${msg.fuelUsed}, Turns: ${msg.turnsUsed}`,
                );
                ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case ServerMsgType.LeavePlanetResult:
                ctx.term.writeln(
                    `\r\n${colors.white('You return to your ship and leave the planet.')}`,
                );
                ctx.setSectorPlayers(msg.players);
                showSectorDisplay(
                    ctx,
                    msg.sector,
                    msg.warps,
                    msg.players,
                    msg.port,
                    msg.sectorDrones,
                    msg.planets,
                    msg.collisions,
                );
                break;
            case ServerMsgType.MenuChanged:
                // Acknowledged by server, menu already set via envelope
                break;
            case ServerMsgType.VisitedSectorsResult:
                renderVisitedSectorsResult(ctx, msg);
                break;
            case ServerMsgType.ListPlanetsResult: {
                ctx.term.writeln('');
                if (msg.planets.length === 0) {
                    ctx.term.writeln(colors.white('You own no planets.'));
                } else {
                    ctx.term.writeln(colors.boldCyan('=== Your Planets ==='));
                    for (const p of msg.planets) {
                        ctx.term.writeln(
                            `  ${colors.boldYellow(`Sector ${p.sectorNumber}`)} — ${colors.boldCyan(p.name)} (${colors.white(p.type)})`,
                        );
                        ctx.term.writeln(
                            `    Fuel col: ${p.colonists_fuel}  Org col: ${p.colonists_organics}  Equ col: ${p.colonists_equipment}`,
                        );
                    }
                }
                showComputerPrompt(ctx);
                break;
            }
            case ServerMsgType.Error:
                ctx.term.writeln(`\r\n${colors.boldRed('Error:')} ${colors.red(msg.message)}`);
                if (ctx.mode === 'docked') showDockedMenu(ctx);
                else if (ctx.mode === 'deployDronesQty') {
                    ctx.setMode('sector');
                    showPrompt(ctx);
                } else if (ctx.mode === 'droneEncounter' || ctx.mode === 'droneAttackQty') {
                    // Stay in encounter mode — re-prompt
                } else if (ctx.mode === 'sector') showPrompt(ctx);
                break;
        }
    });
    ws.addEventListener('error', () => {
        ctx.term.writeln(`\r\n${colors.boldRed('Connection error.')}`);
    });
}
