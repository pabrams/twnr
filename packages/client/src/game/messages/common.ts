/**
 * Shared template fragments reused across multiple domains.
 * Tag cheat sheet in /game/messages/README or /game/renderer.ts.
 */

import { makeDomain } from './_domain.js';

export const COMMON = makeDomain('COMMON', {
    menuRow: '  [mg]<[/mg][g]{key}[/g][mg]>[/mg]  [g]{text}[/g]',
    indexRow: '  [by]{key}[/by]  {text}',
    backRow: '[mg]<[/mg][g]Q[/g][mg]>[/mg]  [g]{text}[/g]',
    yesNoPrompt: '[mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg]',
    listHeader: '[bc]=== {title} ===[/bc]',
    howManyPrompt: '\r\n[c]How many {item}?[/c] ',
    errorLine: '[br]{text}[/br]',
});
