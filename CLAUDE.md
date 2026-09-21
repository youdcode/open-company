@AGENTS.md

## Claude Code specifics

- Roles are available as subagents in `.claude/agents/` (generated from `roles/`). Delegate to them.
- Skills are available as slash commands: `/setup`, `/prospect`, `/qualify`, `/draft-outreach`,
  `/follow-ups`, `/sprint`. Plain words from the command table work too.
- The live page is started by the SessionStart hook (`viewer/ensure.mjs`).
