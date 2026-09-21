#!/usr/bin/env node
// Creates workspace/ from templates/workspace/. Never overwrites an existing file.
// Usage: node tools/init.mjs
import fs from 'node:fs';
import path from 'node:path';
import { WS, TEMPLATES, logEvent, isMain } from './lib/common.mjs';

export function init({ quiet = false } = {}) {
  const created = [];
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name === '.gitkeep') continue;
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) walk(s, d);
      else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); created.push(path.relative(WS, d)); }
    }
  };
  const fresh = !fs.existsSync(WS);
  walk(TEMPLATES, WS);
  if (fresh) logEvent('director', 'system', 'Workspace created. The company is ready to be set up.');
  if (!quiet) console.log(created.length ? `workspace ready (${created.length} files created)` : 'workspace already initialized');
  return created;
}

if (isMain(import.meta.url)) init();
