import { ClientMsgType, Menu } from '@twnr/shared';
import { echoCommand, showPortMenu, showHelp, showPlayerInfo, showPrompt } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Sector, {
    renderPrompt: showPrompt,
    input(ctx, line) {
        const cmd = line.trim();
        // Numeric input is a direct warp-to-sector.
        if (/^\d+$/.test(cmd)) {
            const sector = parseInt(cmd, 10);
            echoCommand(ctx, 'move', { sector });
            ctx.io.sendMsg({ type: ClientMsgType.Move, sector });
            return;
        }
        switch (cmd.toLowerCase()) {
            case '<':
                echoCommand(ctx, 'moveToPrevious');
                ctx.io.sendMsg({ type: ClientMsgType.MoveToPrevious });
                break;
            case '':
                echoCommand(ctx, 'sectorDisplay');
                ctx.io.sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case 'p':
                if (!ctx.world.currentPort) {
                    showPortMenu(ctx); // renders "No port in this sector." + sector prompt
                    break;
                }
                echoCommand(ctx, 'portInfo');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Port });
                break;
            case 'i':
                echoCommand(ctx, 'shipInfo');
                showPlayerInfo(ctx);
                break;
            case '?':
                showHelp(ctx);
                break;
            case 'a':
                echoCommand(ctx, 'attack');
                ctx.io.sendMsg({ type: ClientMsgType.Attack });
                break;
            case 'c':
                echoCommand(ctx, 'computer');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
                break;
            case 'm':
                echoCommand(ctx, 'moveMenu');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Move });
                break;
            case 'd':
                echoCommand(ctx, 'deployDronesInfo');
                ctx.io.sendMsg({ type: ClientMsgType.DeployDronesInfo });
                break;
            case 'j':
                echoCommand(ctx, 'jettison');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.JettisonConfirm });
                break;
            case 'g':
                echoCommand(ctx, 'listDeployedDrones');
                ctx.io.sendMsg({ type: ClientMsgType.ListDeployedDrones });
                break;
            case 'n':
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.DeployMines });
                break;
            case 'e':
                ctx.io.sendMsg({ type: ClientMsgType.ListDeployedMines });
                break;
            case 'r':
                ctx.io.sendMsg({
                    type: ClientMsgType.ChangeMenu,
                    menu: Menu.MineDisruptorTarget,
                });
                break;
            case 'l':
                echoCommand(ctx, 'land');
                ctx.io.sendMsg({ type: ClientMsgType.Land });
                break;
            case 'u':
                echoCommand(ctx, 'terraformInfo');
                ctx.io.sendMsg({ type: ClientMsgType.TerraformInfo });
                break;
            case 'v':
                echoCommand(ctx, 'starbaseInfo');
                ctx.io.sendMsg({ type: ClientMsgType.StarbaseInfo });
                break;
            case 'q':
                echoCommand(ctx, 'quit');
                ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.QuitConfirm });
                break;
            case '#':
                echoCommand(ctx, 'playersOnline');
                ctx.io.sendMsg({ type: ClientMsgType.PlayersOnline });
                break;
        }
    },
});
