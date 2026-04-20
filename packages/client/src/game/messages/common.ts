/**
 * Shared template fragments reused across multiple domains.
 * Tag cheat sheet in /game/messages/README or /game/renderer.ts.
 */

import { makeDomain } from './_domain.js';

export const COMMON = makeDomain('COMMON', {
    /** Standard menu row — `  [c]K[/c]  label` */
    menuRow: '  [mg]<[/mg][g]{key}[/g][mg]>[/mg]  [g]{text}[/g]',

    /** Row with a bold-yellow letter/index rather than cyan */
    indexRow: '  [by]{key}[/by]  {text}',

    /** "Back" / "Cancel" / "Quit" style tail row */
    backRow: '[mg]<[/mg][g]Q[/g][mg]>[/mg]  [g]{text}[/g]',
    // backRow: '  [c]Q[/c]  {text}',

    /** Generic `(Y/N)` confirmation prompt suffix */
    yesNoPrompt: '[mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg]',

    /** Framed title header used for list screens */
    listHeader: '[bc]=== {title} ===[/bc]',

    /** Generic `How many X?` prompt */
    howManyPrompt: '\r\n[c]How many {item}?[/c] ',

    /** Red error line */
    errorLine: '[br]{text}[/br]',
});
