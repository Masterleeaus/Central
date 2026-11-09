#!/usr/bin/env node
// Validates the launcher configuration and copies the runtime files to dist/launcher.
// No bundler and no network access: the output is the same source tree, checked and copied.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfigFile } from '../src/config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const configPath = process.env.LAUNCHER_CONFIG ?? `${root}config/launcher.json`;
loadConfigFile(configPath);

const out = `${root}dist/launcher`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['src', 'public', 'config']) cpSync(`${root}${dir}`, `${out}/${dir}`, { recursive: true });
console.log(`launcher built to ${out}`);
