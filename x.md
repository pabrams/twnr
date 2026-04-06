Client type: CmdCommand
Wire: cmd
Handler: handleCmd
Server Response Type: ** CmdResultObject (instead of CmdResultMessage or CmdMessage)
string type e.g. "portTransactionResult": CmdResult


for shared things like BuyResultMessage, split them up using aliases (or just split to separate types) so that there is a 1:1 mapping. For example, I don't like `BuyResultMessage` because it's too generic, could be buying anything. I'd rather have BuyFighterResult and BuyFighterResultObject to be more clear, even if they have the same functionality. Except in this particular case you could probably actually reshape the result to only have the indicated thing.

Not sure what the difference is between DockResultMessage and PortInfoMessage. I guess maybe the former is an extra message about docking, whereas portInfo might be obtainable from elswhere. In cases like this, I guess the response type should be composite? And we would show teh outer one? Not totally sure. If it's obvious what should be done, do it, if not, jsut rename the obvious object and leave the other alone for now (e.g. rename DockResultMessage if appropriate but not PortInfoMessage because the latter actually goes with the portInfo command).

Also the undock message result doesn't seem right.

Like in cases such as "PlanetDisplayResultMessage" for both landOnPlanet and planetDisplay, I think we should call one LandOnPlanetResult, and the other PlanetDisplayResult, and if they really are the same thing, so be it, but we have the option of handling them differently on the client side. 

So anyway, here are my desired "Cmd", so I want to rename everything to correspond to the following convention:  

Client type: CmdCommand
Wire: cmd
Handler: handleCmd
Server Response Type: ** CmdResultObject (instead of CmdResultMessage or CmdMessage)
string type e.g. "portTransactionResult": CmdResult

If changing something will break stuff and you're not sure what to do, ask me. 

Cmd	Wire
move	move
sectorDisplay	sectorDisplay
playersOnline	who
warpsOut	sector
shortestPath	path
portInfo	portInfo
shipInfo	ship
cargoInfo	cargoInfo
portTransaction	portTransaction
buyFighters	buyFighters
buyShields	buyShields
buyHolds	buyHolds
buyShipTradein	shipExchange
attackShip	attack
dock	dock
undock	undock
jettison	jettison
land	land
takeColonists	takeColonists
leaveColonists	leaveColonists
deployFightersInfo	deployFightersInfo
deployFighters	deployFighters
attackSectorFighters	attackSectorFighters
retreatFromFighters	retreatFromFighters
useTerraformDevice	useTerraformDevice
landOnPlanet	landOnPlanet
planetDisplay	planetDisplay
destroyPlanet	destroyPlanet
leavePlanet	leavePlanet
buyPlanetBusters	buyPlanetBusters
buyTerraformDevices	buyTerraformDevices
dockStardock	dockStardock
leaveStardock	leaveStardock