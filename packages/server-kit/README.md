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
- **A tool** is made with `defineTool`, which ties `run`'s input to `input`;
  `tools` takes nothing else. It says what it changes as one `effects` —
  `read-only` changes nothing, `additive` only adds, `destructive` may
  overwrite or remove — from which `readOnlyHint` and `destructiveHint` are
  derived, so the two never disagree. It may name a `view`, and say who may
  call it in `callers` (the standard's `visibility`, default
  `["model", "app"]`).
- **Every tool answers in text.** `run` returns `text` that stands on its own,
  and optional JSON `data`, sent as `structuredContent` for the view. Input
  that does not parse, a `run` that throws, and an answer that is not text
  with JSON data are tool errors (`isError`) naming the tool, never successes.
- **`defineExtension` checks the definition once** and makes it an
  `Extension`, which is all that can be served. It throws a `DefinitionError`
  naming every problem; the rules are listed on `defineExtension`.

## Module map

| Module | What it owns |
| --- | --- |
| `src/definition.ts` | The definition: views, tools, effects, callers, its checks, and the `Extension` they make. |
| `src/negotiation.ts` | Whether the client of one request renders MCP Apps. |
| `src/server.ts` | The MCP server built from an extension (`serverFactory`). |
| `src/transports.ts` | Serving it over stdio and over HTTP on this machine. |
| `src/testing.ts` | The client fixture and sample extension the tests share. |

## Negotiation, per request

A server offers UI only to a client whose
`capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` includes
`text/html;profile=mcp-app`, and declares the same extension in its own
capabilities. To any other client it is a plain MCP server:

| | Renders MCP Apps | Does not |
| --- | --- | --- |
| `tools/list` | every tool; `_meta.ui` carries its view, and its callers when they are not the default | only tools the model may call, without `_meta.ui` |
| `tools/call` | any tool | a tool only the app may call is unknown |
| `resources/list` | the views, with their `_meta.ui` | nothing |
| `resources/read` | a view's HTML and `_meta.ui` | the same: the standard lets a server leave views out of the list, not refuse them, and a host may render apps without declaring the extension |

The deprecated flat `_meta["ui/resourceUri"]`, which the reference SDK still
writes, is not: the standard removes it before GA, and this package keeps one
current contract.

The decision is made for each request, because the protocol carries client
capabilities two ways. A 2025-era client declares them once, in `initialize`; a
2026-07-28 request carries them in its own `_meta` envelope, and two requests
to one HTTP endpoint may come from different clients. So a server made for a
2026-07-28 client reads the request's envelope, and one made for a 2025-era
client reads `initialize` — never a 2025-era request's own `_meta`, which is
the client's and not validated as an envelope. It is built on the SDK's low-level `Server`, whose handlers see each request, rather
than `McpServer`, which lists one fixed set of tools.

## Transports

`serveOverStdio(extension)` serves on this process's stdin and stdout, as
`npx @nessalabs/<name>` runs an extension.

`serveOverHttp(extension, { host, port, path, maxSessions, onerror })` serves
streamable HTTP on a loopback address (`127.0.0.1` by default, or `::1`; a free
port unless one is given; at `/mcp`), and resolves with the bound `url` and a
`close`:

- **2026-07-28 requests** are each answered by a fresh server, since each
  carries its client's capabilities.
- **2025-era clients** get a session: one server for the session's life, found
  by its `Mcp-Session-Id`, so later requests are answered knowing what
  `initialize` declared. Only an `initialize` opens one, and an unknown
  session id is answered `404`. A client that goes away without ending its
  session leaves nothing that says so, so sessions are bounded by closing,
  not refusing: when `maxSessions` (64) are open, a new one closes the
  session used longest ago. Its client, if it comes back, is answered `404`
  and starts a new session, as the protocol has it.
- **Only this machine.** A request whose `Host` or `Origin` names anything else
  is refused `403`, which keeps a web page from reaching the server by DNS
  rebinding. A request target that is not a path is answered `400`, and one
  outside `path` `404`. Serving a remote host needs authentication and is not
  built here
  ([#11](https://github.com/nessalabs/nessa-extensions/issues/11)).

## Tests

`src/*.test.ts` drive the server with the SDK's own MCP client, in both
protocol eras, declaring MCP Apps or not, over the SDK's stdio entry and over
HTTP; `transports.test.ts` also runs the sample extension as a child process
over real stdio (`src/stdio.fixture.ts`).
