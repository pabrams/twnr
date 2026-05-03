import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

/**
 * Per-worktree test DB: <leaf>_<8-char-hash>_test. Mirrors src/db/pool.ts
 * and appends `_test`. PGDATABASE overrides.
 */
export function deriveTestDbName() {
  if (process.env.PGDATABASE) return process.env.PGDATABASE;
  let root;
  try {
    root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    root = process.cwd();
  }
  const sanitized =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'twnr';
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
  return `${sanitized}_${hash}_test`;
}
