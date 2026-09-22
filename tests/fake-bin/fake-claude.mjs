// A fake "claude" used by the tests: it reads the prompt on stdin and answers in stream-json,
// like Claude Code in headless mode. It echoes the resume id it received so tests can check it.
const args = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', d => { prompt += d; });
process.stdin.on('end', async () => {
  const delay = Number(process.env.FAKE_DELAY_MS || 0);
  const i = args.indexOf('--resume');
  const resumed = i >= 0 ? args[i + 1] : '';
  const out = o => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'system', subtype: 'init', session_id: resumed || 'fake-session-1' });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node tools/leads.mjs list' } }] } });
  if (delay) await new Promise(r => setTimeout(r, delay));
  const direct = /talking directly to the .*?\(([a-z-]+)\)/.exec(prompt);
  const role = direct ? direct[1] : 'director';
  const words = prompt.split('\n\n---\n')[0].trim();
  const lang = /Reply in French/.test(prompt) ? ' (fr)' : '';
  const d = args.indexOf('--add-dir');
  const dirs = d >= 0 ? ` (can read: ${args.slice(d + 1, args.indexOf('--allowedTools')).join(', ')})` : '';
  out({ type: 'assistant', message: { content: [{ type: 'text', text: `[${role}]\n**Got it**: ${words}${lang}${dirs}${resumed ? ` (resumed ${resumed})` : ''}` }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: resumed || 'fake-session-1' });
});
