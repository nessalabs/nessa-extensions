# Nessa extensions

Nessa's first-party extensions. Each one is an MCP server that ships its own
interactive UI as an [MCP App](https://github.com/modelcontextprotocol/ext-apps)
(`io.modelcontextprotocol/ui`), so it works in
[Nessa](https://github.com/nessalabs/nessa-agent) and in any other host that
supports MCP Apps — and, as plain tools with text results, in any MCP host at
all.

Why they live here rather than in the app, and how the repository is laid out,
is in the [decision record](docs/adr/todo/1-extensions-repo.md). How to work in
it is in [AGENTS.md](AGENTS.md).

## Extensions

| Package | What it is | Status |
| --- | --- | --- |
| `@nessalabs/experiments` | An experiment's overview, areas, runs, and run detail, with an inline card in the conversation | Planned: #4–#7 |

## How an extension works

```mermaid
sequenceDiagram
  participant Model
  participant Host as MCP host (Nessa, ChatGPT, …)
  participant Server as Extension server
  participant App as Extension app (sandboxed iframe)
  Host->>Server: initialize, with capabilities.extensions["io.modelcontextprotocol/ui"]
  Server-->>Host: tools, each naming its view in _meta.ui.resourceUri
  Model->>Host: call a tool
  Host->>Server: tools/call
  Server-->>Host: result: text for the model, structured data for the view
  Host->>Server: resources/read ui://…
  Server-->>Host: text/html;profile=mcp-app, with _meta.ui.csp
  Host->>App: render in a sandboxed iframe on its own origin
  App->>Host: ui/initialize
  Host-->>App: host context (theme, locale, display mode, size)
  Host->>App: ui/notifications/tool-input, then tool-result
  App->>Host: tools/call on its own server
  Host->>Server: tools/call (only tools visible to the app)
  Server-->>Host: result
  Host-->>App: result
```

A host without MCP Apps stops after the tool result, and the text in it stands
on its own.

## Using an extension

Every extension is an npm package that runs as a stdio MCP server:

```sh
npx -y @nessalabs/<name>
```

It can also serve streamable HTTP, for hosts that connect to a remote server;
the option that selects it is set by
[#3](https://github.com/nessalabs/nessa-extensions/issues/3).

**Nessa.** Add it to `agents.mcpServers` in the gateway's `config.json`, as
[the gateway guide](https://github.com/nessalabs/nessa-agent/blob/main/docs/guides/gateway-chat.md#local-setup)
describes, with an absolute path to `npx`:

```json
{
  "name": "<name>",
  "command": "/absolute/path/to/npx",
  "args": ["-y", "@nessalabs/<name>"]
}
```

Its tools reach the agent there today, as any configured server's do, with
their text results. Its view needs Nessa to host MCP Apps, which is
[nessalabs/nessa-agent#345](https://github.com/nessalabs/nessa-agent/issues/345).

**ChatGPT.** ChatGPT does not start local processes. Serve the extension over
streamable HTTP at a public HTTPS URL (typically ending in `/mcp`), or reach
the stdio server through OpenAI's Secure MCP Tunnel. Turn on developer mode
(Settings → Security and login), then add the server under ChatGPT Plugins, as
[OpenAI's guide](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)
describes.

**Other hosts** that take a stdio server — Claude Desktop, Claude Code, VS Code,
Goose, and others — use the usual `mcpServers` entry:

```json
{
  "mcpServers": {
    "<name>": { "command": "npx", "args": ["-y", "@nessalabs/<name>"] }
  }
}
```

or, in Claude Code, `claude mcp add <name> -- npx -y @nessalabs/<name>`. A
host that supports MCP Apps shows the view; any other shows the text results.

## Publishing

Each extension under [`extensions/`](extensions) is published to npm as
`@nessalabs/<name>`. Its package holds the server, the app built into one
self-contained HTML file that the server serves as its `ui://` resource, and a
`bin` that `npx` runs. The shared packages under [`packages/`](packages) are
bundled into it and are not published on their own.

Nothing is published yet, and nothing publishes from a pull request. The
release workflow arrives with the first extension; until then every package is
`private`.

## Development

Requires Node 22.13 or later and pnpm 11.9.0.

```sh
pnpm install
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs these on every
pull request and on `main`; run the ones your change touches before pushing.

| Command | What it checks |
| --- | --- |
| `pnpm format:check` | Prettier |
| `pnpm lint` | ESLint, with typescript-eslint |
| `pnpm typecheck` | TypeScript, strict |
| `pnpm test` | Vitest, over every package and extension |
| `pnpm architecture` | What an extension and a package may import ([`scripts/check-architecture.mjs`](scripts/check-architecture.mjs)), after its own tests. Bare Node: CI runs it before installing anything |

```
packages/
  app-shell/     the browser side of an app (#2)
  server-kit/    the server side of an extension (#3)
extensions/      one directory per extension; see its README
scripts/         the architecture check
docs/adr/        decision records
```

`nessa_ui`, Nessa's design system, is consumed the way nessa-agent consumes
it — a commit pinned in `nessa-ui-revision` and fetched on install — from
[#2](https://github.com/nessalabs/nessa-extensions/issues/2), the first package
to import it. The [decision record](docs/adr/todo/1-extensions-repo.md) says
why it is not here yet.

## License

[MIT](LICENSE)
