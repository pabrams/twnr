// Auto-link `twnr` onto PATH after local installs.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pnpmHome = process.env.PNPM_HOME;
if (process.env.CI || !pnpmHome) process.exit(0);
if (existsSync(join(pnpmHome, 'twnr'))) process.exit(0);

const cliDir = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd) => execSync(cmd, { cwd: cliDir, stdio: 'inherit' });
try {
    run('pnpm --filter @twnr/shared build');
    run('pnpm build');
    run('pnpm link --global');
    console.log('twnr CLI linked — `twnr` is now on your PATH');
} catch {
    console.warn('twnr CLI auto-link failed; run `pnpm link --global` in packages/cli manually');
}
