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
  and optional `data`, a JSON object sent as `structuredContent` for the view
  (typed as any object, so an interface describes it; it is checked when the
  tool answers). Input that does not parse, a `run` that throws, and an
  answer that is anything but `text` with JSON `data` — a missing or blank
  `text`, `data` JSON cannot carry, or a key an answer does not have, such as
  a misspelt `date` — are tool errors (`isError`) naming the tool, never
  successes.
- **`defineExtension` checks the definition once** and makes it an
  `Extension`, which is all that can be served. It parses the definition into
  a frozen copy — each view's `_meta.ui` with the reference SDK's own schemas,
  refusing keys they do not name, a permission's included — and keeps only
  the copy, so what was checked is what is served. One thing is not copied:
  a tool's `input` is the zod schema it was given, which the kit lists once
  and parses every call with, so it must not be changed after `defineTool`.
  (It is not frozen either: zod shares parts of a schema across the
  process, such as the regex behind `z.email()`, and freezing them breaks
  zod for everyone.) It throws a `DefinitionError` naming every problem and where it is; the
  rules are listed on `defineExtension`.
- **What a tool answers is parsed too.** Its input is parsed inside the same
  guard as `run`; its `data` is read once, without running getters, into a
  fresh JSON copy at most 256 levels deep, and the copy is what is sent.
  `data: undefined` is no data.

## Module map

| Module | What it owns |
| --- | --- |
| `src/definition.ts` | The definition: views, tools, effects, callers, its checks, and the `Extension` they make. |
| `src/negotiation.ts` | Whether the client of one request renders MCP Apps. |
| `src/server.ts` | The MCP server built from an extension (`serverFactory`). |
| `src/transports.ts` | Serving it over stdio and over HTTP on this machine. |
| `src/testing.ts` | The client fixture and sample extension the tests share, exported as `@nessalabs/server-kit/testing` so an extension's server tests use the same fixture. |
| `src/stdio.fixture.ts` | The sample extension on real stdio, run as a child process by `transports.test.ts`. |

## Negotiation, per request

A server offers UI only to a client whose
`capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` includes
`text/html;profile=mcp-app`. It declares no extension of its own: its
capabilities are fixed before the client's arrive, MCP Apps defines the
capability for clients only, and the reference SDK's servers declare none. To any other client it is a plain MCP server:

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
the client's and not validated as an envelope.

## Transports

`serveOverStdio(extension, { onerror })` serves on this process's stdin and
stdout, as `npx @nessalabs/<name>` runs an extension, to clients of either
protocol era: the SDK pins one server to the connection, made for the era its
opening chose.

`serveOverHttp(extension, { host, port, path, onerror })` serves streamable
HTTP on a loopback address (`127.0.0.1` by default, or `::1`; a free port
unless one is given; at `/mcp`), and resolves with the bound `url` and a
`close`:

- **2026-07-28 clients only.** Each request carries its client's capabilities,
  so each is answered by a fresh server, and the SDK's `createMcpHandler` owns
  the request from start to end. A 2025-era client declares its capabilities
  once, in `initialize`, and so needs a session; stdio serves it, and HTTP
  refuses it before any server is made: an `initialize` or a request with
  `-32022`, naming the era it serves; a batch with `400`; a `GET` or
  `DELETE` with `405`; a notification is accepted and dropped. 2025-era HTTP
  sessions belong with remote serving
  ([#11](https://github.com/nessalabs/nessa-extensions/issues/11)).
- **Only this machine.** A request whose `Host` or `Origin` names anything else
  is refused `403`, which keeps a web page from reaching the server by DNS
  rebinding. A request target that is not a path is answered `400`, and one
  whose path is not exactly `path` `404`; `path` is checked when serving
  starts. Serving a remote host needs authentication and is #11.

## Tests

`src/*.test.ts` drive the server with the SDK's own MCP client, in both
protocol eras over stdio and in 2026-07-28 over HTTP, declaring MCP Apps or
not; `transports.test.ts` also runs the sample extension as a child process
over real stdio (`src/stdio.fixture.ts`).
