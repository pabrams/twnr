import { randomBytes } from 'crypto';
import { existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '../.env');

if (existsSync(envPath)) {
  console.log('.env already exists, skipping. Delete it and re-run to regenerate.');
  process.exit(0);
}

const env = `JWT_SECRET=${randomBytes(32).toString('hex')}
ADMIN_API_KEY=${randomBytes(16).toString('hex')}
PGDATABASE=twnr
PGUSER=twnr_user
PGPASSWORD=twnr_pass
`;

writeFileSync(envPath, env, { mode: 0o600 });
console.log('Generated .env');
