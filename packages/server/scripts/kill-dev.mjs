
import { execSync } from 'node:child_process';
import { devServerPort } from '@twnr/shared';

function worktreeRoot() {
    try {
        return execSync('git rev-parse --show-toplevel', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return process.cwd();
    }
}

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : devServerPort(worktreeRoot());

try {
    execSync(`fuser -k ${port}/tcp`, { stdio: ['ignore', 'ignore', 'ignore'] });
    console.log(`Killed process on port ${port}`);
} catch {
    // fuser exits non-zero when nothing is listening
}
