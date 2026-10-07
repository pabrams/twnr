/// <reference types="vitest" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { devServerPort } from '@twnr/shared';

function serverPort(): number {
    if (process.env.PORT) return parseInt(process.env.PORT, 10);
    let root: string;
    try {
        root = execSync('git rev-parse --show-toplevel', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        root = process.cwd();
    }
    return devServerPort(root);
}

const port = serverPort();

export default defineConfig({
    server: {
        proxy: {
            '/api': `http://localhost:${port}`,
            '/ws': { target: `ws://localhost:${port}`, ws: true },
        },
    },
    test: {
        environment: 'node',
    },
});
