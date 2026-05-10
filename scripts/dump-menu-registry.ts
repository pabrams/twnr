#!/usr/bin/env tsx
/**
 * Dumps the client-side hardcoded menu registry to docs/menu-registry.json
 * for the docgen pipeline. Replaces the previous DB-querying script — the
 * menu/menu_command/command tables were dropped; the client owns the
 * registry as a TypeScript constant.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MENU_REGISTRY } from '../packages/client/src/game/menu-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'docs', 'menu-registry.json');

writeFileSync(outPath, JSON.stringify(MENU_REGISTRY, null, 2));
console.log(`Menu registry dumped to docs/menu-registry.json (${MENU_REGISTRY.length} menus)`);
