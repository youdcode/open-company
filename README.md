# Open Company

**A company that runs in a folder. Bring the AI you already pay for.**

Open Company is a ready-made team of AI roles (a Director, a Prospect Researcher, a Sales Rep,
a Strategist, a Marketer, Finance, a Tech Lead, a Consultant and an Auditor) that lives in plain
files on your computer. You open the folder with the AI coding tool you already use, and a live
office opens in your browser so you can watch the team work.

Its first job is **prospecting**: finding companies that fit your offer, proving it with sources,
and writing short personal messages that you approve before anything goes out.

- **No API key, no extra bill.** It runs inside Claude Code, Codex or other agent tools, logged in
  with your own plan.
- **Not tied to one AI.** The company is written in open formats (`AGENTS.md`, `SKILL.md`). The AI is
  just the engine you plug in.
- **Every fact has a source.** The rules are enforced by scripts, not only by prompts: a lead without
  a source is rejected, a contact without the page where it was found is rejected, scores are computed
  by code.
- **Nothing is sent without you.** The team drafts, you approve in the live office, you export and
  send with your own tools.
- **Your data stays on your computer.** Everything the company produces lives in `workspace/`, which is
  never committed.

## Quick start

You need [Node.js](https://nodejs.org) 18+ and one supported AI tool, installed and logged in.

```bash
git clone https://github.com/youdcode/open-company.git
cd open-company
./start            # Windows: start.cmd
```

`./start` finds the AI tools installed on your computer, opens the live office at
http://localhost:4747, and launches the AI you pick in this folder. On the first run the Director
interviews you for a few minutes (`setup`), then you can type:

| Type | What happens |
|---|---|
| `prospect 10` | The researcher finds 10 companies that fit, each verified and sourced |
| `qualify` | Dated buying signals and a published contact route, then scoring |
| `draft` | The sales rep writes first messages for the best leads |
| `followups` | Today's follow-ups, drafted |
| `status` | Pipeline and board in six lines |
| `sprint "launch in Belgium"` | The whole company works on one goal, the auditor reviews |
| `export` | Approved messages go to a CSV for your own email tool |

You can also open the folder directly with your AI tool (`claude`, `codex`, `opencode`, `agy`) and
type `start`.

## Supported AI tools

| AI | Tool | How you pay | Status |
|---|---|---|---|
| Claude | [Claude Code](https://code.claude.com) | your Claude plan | tested |
| ChatGPT | [Codex CLI](https://learn.chatgpt.com/docs) with "Sign in with ChatGPT" | your ChatGPT plan | configured from the official docs, not yet tested |
| Gemini | [Antigravity CLI](https://antigravity.google) | free Google account (limited weekly quota) or a Google plan | configured from the official docs, not yet tested |
| DeepSeek, local models, others | [OpenCode](https://opencode.ai) | the provider's API key, or free local models | configured from the official docs, not yet tested |

Perplexity is a search engine rather than an agent tool. It can be plugged in later as a search
source through its API (paid).

Results depend on the model. Weaker models follow the rules less reliably, which is one reason the
important rules are enforced by scripts. Reports from people testing other tools are very welcome.

## The live office

A local web page (it never calls an AI, so it costs nothing) that shows:

- **Office**: the organization chart, who is working right now, and a live activity feed
- **Pipeline**: every lead with its score, signals, next action and sources
- **Outreach**: drafted messages with Approve and Reject buttons
- **Board**: tasks across the company (Todo, Doing, Review, Done)
- **Handoffs**: the short notes the roles pass to each other
- **Files**: everything the company has produced

It listens on `127.0.0.1` only and refuses requests from other websites. Run it alone with
`./start --viewer-only`.

## How it works

```
 you ──> your AI tool (Claude Code, Codex, OpenCode, Antigravity)
             │ reads
             ▼
         AGENTS.md ............ the Director's manual: commands, team, protocol, rules
         roles/*.md ........... one brief per role (single source of truth)
         .agents/skills/ ...... playbooks: setup, prospect, qualify, draft-outreach, follow-ups, sprint
             │ runs
             ▼
         tools/*.mjs .......... scripts that enforce the rules and write the shared files
             │ write
             ▼
         workspace/ ........... leads.csv, account files, drafts, board, handoffs, events
             │ watched by
             ▼
         viewer/ .............. the live office at http://localhost:4747
```

- The roles talk through files: a task board, short handoff notes, and an event log. Any AI tool can
  follow that protocol, and you can read all of it.
- `npm run sync` turns `roles/*.md` into each tool's native subagent format (`.claude/agents`,
  `.codex/agents`, `.opencode/agents`, `.agents/agents`) and mirrors the skills for Claude Code.
- Zero dependencies: plain Node.js scripts and one HTML file.

## Rules enforced by code

| Rule | Where |
|---|---|
| No source, no lead | `tools/leads.mjs` rejects leads without an http(s) source |
| No guessed contacts | a contact name or channel requires `contact_source` |
| Dated signals only | signals must look like `hiring@2026-09-02` |
| Scores are computed, not invented | `tools/score.mjs`, from the rules in your `icp.md` |
| Nothing sent without you | drafts need approval; `tools/export.mjs` only writes a CSV |
| Opt-outs are final | no draft for a lead marked `do_not_contact` |
| Short handoffs | `tools/handoff.mjs` refuses long messages |

The other rules (primary sources, no LinkedIn scraping, minimal personal data, no invented claims)
are in `AGENTS.md` and checked by the Auditor.

## Usage limits

Your AI plan has usage limits shared with everything else you do. A multi-role run uses more than
a chat. To spend less, the company:

- gives each role a short brief and asks for 10-line reports
- does mechanical work (scoring, exporting, counting) in scripts
- stops searching once the target is reached
- routes simpler roles to lighter models where the tool allows it (see `tier` in `roles/*.md`)

Start with small batches (`prospect 5`) to see what your plan allows.

## What runs on your computer

- `./start`: prepares `workspace/`, serves the live office, launches your AI tool.
- Session hooks (`.claude/settings.json`, `.codex/hooks.json`): run `node viewer/ensure.mjs`, which
  starts the live office if it is not running. That is all they do. When you open the folder
  interactively for the first time, your AI tool asks whether you trust it.
- Permissions: the project allows the AI to write in `workspace/`, run `node tools/...`, and search the
  web. Everything else asks you first. These project permissions only apply once you have accepted
  your tool's "trust this folder" prompt, so run `./start` (interactive) the first time rather than a
  headless command.
- No telemetry. Nothing is sent anywhere except the web searches your AI tool makes and, for French
  companies, queries to the official public registry.

## Prospecting and the law

You are responsible for how you contact people. In the European Union, the GDPR applies to data about
people, including business contacts, and some countries add rules on commercial email. In France,
for example, the CNIL allows B2B prospecting emails without prior consent when the message relates to
the person's job, as long as they are informed and can object easily. The drafts include an opt-out
line for this reason. Check the rules of your country.

## Customize

- Change a role: edit `roles/<role>.md`, then `npm run sync`.
- Change a playbook: edit `.agents/skills/<name>/SKILL.md`, then `npm run sync`.
- Add a data source: add a script in `tools/` and mention it in `AGENTS.md`.
- Run the checks: `npm test` (add `-- --online` to also query the registry).

## Roadmap

- Test and tune Codex, OpenCode and Antigravity
- More official company registries (UK, Belgium, Germany...)
- Optional search sources through MCP (Perplexity and others)
- Reply tracking from your mailbox, with approval
- Playbooks for the other departments (marketing calendar, invoicing, proposals)

## Not affiliated

Open Company is an independent project. It is not affiliated with or endorsed by Anthropic, OpenAI,
Google, DeepSeek, Perplexity or the makers of OpenCode. Product names belong to their owners.

## License

MIT
