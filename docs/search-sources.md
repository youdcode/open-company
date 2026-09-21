# Optional search sources

Every supported AI tool already has its own web search. You can add a dedicated search engine as an
MCP server. It is optional and usually paid per query.

## Perplexity

Official server: [perplexityai/modelcontextprotocol](https://github.com/perplexityai/modelcontextprotocol)
(npm package `@perplexity-ai/mcp-server`). It needs an API key from
[console.perplexity.ai](https://console.perplexity.ai/project/keys). Credits are prepaid; see
[Perplexity pricing](https://docs.perplexity.ai/getting-started/pricing). A Perplexity Pro subscription
does not include API credits.

Keep the key out of the repository: put it in your shell environment (`export PERPLEXITY_API_KEY=...`).

**Claude Code**

```bash
claude mcp add perplexity --env PERPLEXITY_API_KEY="$PERPLEXITY_API_KEY" -- npx -y @perplexity-ai/mcp-server
```

**Codex CLI** (`~/.codex/config.toml`)

```toml
[mcp_servers.perplexity]
command = "npx"
args = ["-y", "@perplexity-ai/mcp-server"]
env_vars = ["PERPLEXITY_API_KEY"]
```

**OpenCode** (`opencode.json`, merge with the existing file)

```json
{
  "mcp": {
    "perplexity": {
      "type": "local",
      "command": ["npx", "-y", "@perplexity-ai/mcp-server"],
      "enabled": true,
      "environment": { "PERPLEXITY_API_KEY": "{env:PERPLEXITY_API_KEY}" }
    }
  }
}
```

**Antigravity CLI** (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server"],
      "env": { "PERPLEXITY_API_KEY": "your_key" }
    }
  }
}
```

The server exposes `perplexity_search`, `perplexity_ask`, `perplexity_research` and `perplexity_reason`.
The Director's manual tells the team to use it when it is there and to batch questions.

## Official company registers

| Country | Tool | Key |
|---|---|---|
| France | `tools/registry-fr.mjs` | none |
| Norway | `tools/registry-no.mjs` | none (employee filters start at 5, a privacy rule of the register) |
| United Kingdom | `tools/registry-uk.mjs` | free: create a live application and a REST key at [Companies House](https://developer.company-information.service.gov.uk/manage-applications/add), then add `COMPANIES_HOUSE_API_KEY=...` to `workspace/.env` |

Adding a country: copy one of these scripts, map the answer to the same fields (`company`,
`registry_id`, `country`, `city`, `industry`, `employees`, `sources`), drop birth dates and private
addresses, and mention it in `AGENTS.md`.
