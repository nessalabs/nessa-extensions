# @nessalabs/server-kit

What an extension's MCP server is built on: the server's side of MCP Apps, so
every extension declares its UI the same way. Built in
[#3](https://github.com/nessalabs/nessa-extensions/issues/3).

It is private: an extension's build bundles it into the published package (see
the [repository's decision record](../../docs/adr/todo/1-extensions-repo.md)).

## Using it

```ts
import { readFileSync } from "node:fs"

import { defineExtension, defineTool, serveOverStdio } from "@nessalabs/server-kit"
import { z } from "zod/v4"

const board = defineExtension({
  name: "board",
  version: "0.1.0",
  views: [
    {
      uri: "ui://board/view",
      name: "board",
      html: () => readFileSync(new URL("./app.html", import.meta.url), "utf8"),
      ui: { prefersBorder: true },
    },
  ],
  tools: [
    defineTool({
      name: "show_board",
      description: "Shows the board",
      input: z.object({ rows: z.number().int().min(1) }),
      effects: "read-only",
      view: "ui://board/view",
      run: ({ rows }) => ({ text: `The board has ${rows} rows.`, data: { rows } }),
    }),
  ],
})

serveOverStdio(board)
```

- **A view** is a `ui://` resource served as `text/html;profile=mcp-app`, with
  the standard's `_meta.ui` (`csp`, `permissions`, `domain`, `prefersBorder`)
  as given in `ui`.
- **A tool** says what it changes as one `effects` — `read-only`, `additive`
  or `destructive` — from which `readOnlyHint` and `destructiveHint` are
  derived, so the two never disagree. It may name a `view`, and say who may
  call it in `callers` (the standard's `visibility`, default
  `["model", "app"]`).
- **Every tool answers in text.** `run` returns `text` that stands on its own,
  and optional `data`, sent as `structuredContent` for the view. Input that
  does not parse, a `run` that throws, and an answer without text are tool
  errors (`isError`), never successes.
- **`defineExtension` checks the definition once** and throws a
  `DefinitionError` naming every problem: a view URI that is not `ui://` with a
  host, a view or tool declared twice, a tool naming an undeclared view,
  callers that are empty, repeated or unknown, and a CSP domain that is not an
  origin.

## Module map

| Module | What it owns |
| --- | --- |
| `src/definition.ts` | The definition: views, tools, effects, callers, and its checks. |
| `src/negotiation.ts` | Whether the client of one request renders MCP Apps. |
| `src/server.ts` | The MCP server built from a definition (`serverFactory`). |
| `src/transports.ts` | Serving it over stdio and over HTTP on this machine. |
| `src/testing.ts` | The client fixture and sample extension the tests share. |

## Negotiation, per request

A server offers UI only to a client whose
`capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` includes
`text/html;profile=mcp-app`, and declares the same extension in its own
capabilities. To any other client it is a plain MCP server:

| | Renders MCP Apps | Does not |
| --- | --- | --- |
| `tools/list` | every tool; `_meta.ui` carries its view and callers | only tools the model may call, without `_meta.ui` |
| `tools/call` | any tool | a tool only the app may call is unknown |
| `resources/list` | the views, with their `_meta.ui` | nothing |
| `resources/read` | a view's HTML and `_meta.ui` | not found |

The decision is made for each request, because the protocol carries client
capabilities two ways. A 2025-era client declares them once, in `initialize`; a
2026-07-28 request carries them in its own `_meta` envelope, and two requests
to one HTTP endpoint may come from different clients. So the server reads the
request's envelope first and the connection's `initialize` second, and it is
built on the SDK's low-level `Server`, whose handlers see each request, rather
than `McpServer`, which lists one fixed set of tools.

## Transports

`serveOverStdio(definition)` serves on this process's stdin and stdout, as
`npx @nessalabs/<name>` runs an extension.

`serveOverHttp(definition, { host, port, path, maxSessions })` serves streamable
HTTP on a loopback address (`127.0.0.1` by default, a free port unless one is
given, at `/mcp`), and resolves with the bound `url` and a `close`:

- **2026-07-28 requests** are each answered by a fresh server, since each
  carries its client's capabilities.
- **2025-era clients** get a session: one server for the session's life, found
  by its `Mcp-Session-Id`, so later requests are answered knowing what
  `initialize` declared. Only an `initialize` opens one; an unknown session id
  is answered `404`; at most `maxSessions` (64) are open at once, and another
  `initialize` is answered `503` until one ends.
- **Only this machine.** A request whose `Host` or `Origin` names anything else
  is refused `403`, which keeps a web page from reaching the server by DNS
  rebinding. Serving a remote host needs authentication and is not built here
  ([#11](https://github.com/nessalabs/nessa-extensions/issues/11)).

## Tests

`src/*.test.ts` drive the server with the SDK's own MCP client, in both
protocol eras, declaring MCP Apps or not, over the SDK's stdio entry and over
HTTP; `transports.test.ts` also runs the sample extension as a child process
over real stdio (`src/stdio.fixture.ts`).
