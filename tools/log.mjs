#!/usr/bin/env node
// Post a line to the live feed (the local page shows it instantly).
// Usage: node tools/log.mjs <role> "<what you are doing>" [--path file] [--type work]
import { logEvent, args, fail, requireWorkspace, helpIfAsked } from './lib/common.mjs';

helpIfAsked(import.meta.url);

requireWorkspace();
const a = args();
const [role, ...words] = a._;
if (!role || !words.length) fail('usage: node tools/log.mjs <role> "<message>" [--path file]');
logEvent(role, typeof a.type === 'string' ? a.type : 'work', words.join(' '), typeof a.path === 'string' ? a.path : '');
console.log('logged');
