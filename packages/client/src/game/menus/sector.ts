import { ClientMsgType, Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { echoCommand, showPortMenu, showHelp, showPlayerInfo, showPrompt } from '../display.js';
import { registerMenu } from './types.js';

registerMenu(Menu.Sector, {
    enter: showPrompt,
    input(ctx, line) {
        const cmd = line.trim();
        // Numeric input is a direct warp-to-sector.
        if (/^\d+$/.test(cmd)) {
            const sector = parseInt(cmd, 10);
            echoCommand(ctx, 'move', { sector });
            ctx.sendMsg({ type: ClientMsgType.Move, sector });
            return;
        }
        switch (cmd.toLowerCase()) {
            case '<':
                echoCommand(ctx, 'moveToPrevious');
                ctx.sendMsg({ type: ClientMsgType.MoveToPrevious });
                break;
            case '':
                echoCommand(ctx, 'sectorDisplay');
                ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
                break;
            case 'p':
                if (!ctx.currentPort) {
                    showPortMenu(ctx); // renders "No port in this sector." + sector prompt
                    break;
                }
                echoCommand(ctx, 'portInfo');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Port });
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
                ctx.sendMsg({ type: ClientMsgType.Attack });
                break;
            case 'c':
                echoCommand(ctx, 'computer');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
                break;
            case 'm':
                echoCommand(ctx, 'moveMenu');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Move });
                break;
            case 'd':
                echoCommand(ctx, 'deployDronesInfo');
                ctx.sendMsg({ type: ClientMsgType.DeployDronesInfo });
                break;
            case 'j':
                echoCommand(ctx, 'jettison');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.JettisonConfirm });
                break;
            case 'g':
                echoCommand(ctx, 'listDeployedDrones');
                ctx.sendMsg({ type: ClientMsgType.ListDeployedDrones });
                break;
            case 'l':
                echoCommand(ctx, 'land');
                ctx.sendMsg({ type: ClientMsgType.Land });
                break;
            case 'u':
                echoCommand(ctx, 'terraformInfo');
                ctx.sendMsg({ type: ClientMsgType.TerraformInfo });
                break;
            case 'v':
                echoCommand(ctx, 'starbaseInfo');
                ctx.sendMsg({ type: ClientMsgType.StarbaseInfo });
                break;
            case 'q':
                echoCommand(ctx, 'quit');
                ctx.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.QuitConfirm });
                break;
            case '#':
                echoCommand(ctx, 'playersOnline');
                ctx.sendMsg({ type: ClientMsgType.PlayersOnline });
                break;
            default:
                if (line) ctx.term.writeln(render(NOTIFY.unknownCommand, { cmd }));
                showPrompt(ctx);
        }
    },
});
