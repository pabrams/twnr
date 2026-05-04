import { Menu } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY } from '../messages/index.js';
import { showShipExamineList, letterToIndex } from '../display-starbase.js';
import { showShipDetail, showShipInterestPrompt } from '../display-computer.js';
import { registerMenu, registerMenuRoutine } from './types.js';

registerMenu(Menu.ShipyardsExamine, {
    renderPrompt: showShipExamineList,
});

registerMenuRoutine(Menu.ShipyardsExamine, 'view_detail', (ctx, line) => {
    const idx = letterToIndex(line);
    if (ctx.catalogs.ships && idx >= 0 && idx < ctx.catalogs.ships.length) {
        showShipDetail(ctx, ctx.catalogs.ships[idx]);
        showShipInterestPrompt(ctx);
    } else {
        ctx.io.term.writeln(render(NOTIFY.invalidSelection));
        showShipInterestPrompt(ctx);
    }
});
