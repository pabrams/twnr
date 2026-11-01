import { makeDomain } from './_domain.js';

export const COMMON = makeDomain('COMMON', {
    menuRow: '  [mg]<[/mg][g]{key}[/g][mg]>[/mg]  [g]{text}[/g]',
    indexRow: '  [by]{key}[/by]  {text}',
    backRow: '[mg]<[/mg][g]Q[/g][mg]>[/mg]  [g]{text}[/g]',
    yesNoPrompt: '[mg]([/mg][by]Y[/by]/[by]N[/by][mg])[/mg]',
    listHeader: '[bc]=== {title} ===[/bc]',
    howManyPrompt: '\r\n[c]How many {item}?[/c] ',
    errorLine: '[br]{text}[/br]',

    promptInvalidChoice:
        '[y]Invalid choice — [/y][by]{allowed}[/by] [y](Q or Enter to cancel).[/y]',
    promptEnterNumber: '[y]Enter a number (Q to cancel).[/y]',
    promptMinimum: '[y]Minimum is[/y] [by]{min}[/by][y].[/y]',
    promptMaximum: '[y]Maximum is[/y] [by]{max}[/by][y].[/y]',
    promptYesNo: '[y]Please answer Y or N (Q to cancel).[/y]',
});
