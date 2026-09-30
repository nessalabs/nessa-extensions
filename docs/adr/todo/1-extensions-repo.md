# 1. The extensions repository

## Purpose

Nessa's own views — experiments first — are built as MCP servers with MCP Apps,
not as code in the desktop app
([nessa-agent ADR 344](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/todo/344-mcp-ui.md),
proposed in [nessa-agent#350](https://github.com/nessalabs/nessa-agent/pull/350)).
This record decides where they live and how that place is organised, checked,
and published.

- **Date:** 2026-09-30
- **Status:** proposed
- **Issue:** [#1](https://github.com/nessalabs/nessa-extensions/issues/1), part
  of [nessalabs/nessa-agent#345](https://github.com/nessalabs/nessa-agent/issues/345)

## Context

- An extension is an MCP server plus an MCP App: HTML that a host renders in a
  sandboxed iframe and speaks to over the `ui/*` bridge
  ([MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
  `io.modelcontextprotocol/ui`). It must work in Nessa and in any other MCP Apps
  host, so it is written to the standard and never to Nessa's internals.
- Views like experiments change often. ADR 344 wants them to ship, version,
  and fail without the app.
- nessa-agent's `CODING_STANDARDS.md` is the one standards document, and its
  gate 13 says a rule lives in one place.
- A host's default CSP for an app refuses every outside origin, so an app's
  HTML carries its scripts and styles inline unless it declares a domain.
- `nessa_ui`, the design system, is consumed by nessa-agent as a pinned commit
  vendored at install (`nessa-ui-revision`, `scripts/ensure-nessa-ui.mjs`).

## Decision

**A separate repository, nessalabs/nessa-extensions.** The core never imports
an extension, and an extension reaches the core only through the MCP Apps
bridge, so nothing is lost by the distance; what is gained is that the two
cannot be coupled by accident, and an extension's release does not wait on the
app's. Its work is tracked on the
[Nessa Extensions board](https://github.com/orgs/nessalabs/projects/2).

**nessa-agent's standards own every rule.** This repository's `AGENTS.md`
links to nessa-agent's `CODING_STANDARDS.md` and `AGENTS.md` and restates
nothing; it adds only what is about extensions — the layout, MCP Apps
conformance, the sandbox an app may assume, publishing, and the board. A rule
that needs to change for extensions changes there.

**Layout.** A pnpm workspace (pnpm 11.9.0, as nessa-agent and nessa_ui):

```
packages/app-shell     the browser side: the ui/* bridge client, host theming, a fake host (#2)
packages/server-kit    the server side: tools with UI, ui:// resources, negotiation (#3)
extensions/<name>/     one extension, one package @nessalabs/<name>
  server/              its MCP server
  app/                 its MCP App
```

An arrow runs one way: extensions depend on packages. **An extension depends on
nothing in another extension, and a package on nothing in any extension**; what
two extensions share becomes a package, reached by its package name through a
manifest. `pnpm architecture` enforces this as constraints, not as a list of
import forms to catch, and checks outcomes rather than spellings:

- **Nothing resolves into an extension from outside it.** The check reads
  pnpm's resolution, `pnpm-lock.yaml`, where every importer's dependencies are
  recorded as resolved — a workspace link is `link:<path>` however it was
  written: a name, an alias, `workspace:../x`, a bare path in the root, an
  override in `pnpm-workspace.yaml`. CI installs with `--frozen-lockfile`,
  which refuses a lockfile that disagrees with the manifests and overrides, so
  the resolution checked is the one installed. A unit resolves by name only
  what it or the root declares, and neither may be an extension, so an import
  of one by name fails typecheck and test. The first version read the
  manifests instead, and each review found another spelling it missed; that
  is why it reads the outcome.
- **No quoted relative path in any file of an extension or a package leads
  into another unit.** It may leave for somewhere that is not one, such as the
  root's shared configuration or a build directory.
- **No symbolic link sits in a unit**, since one would make a path inside it
  lead into another.

Every extension directory must also be a package, with its own
`package.json`.

**Conformance.** Every extension negotiates `io.modelcontextprotocol/ui` under
`capabilities.extensions`, names its view in `_meta.ui.resourceUri`, serves it
as `text/html;profile=mcp-app` with its `_meta.ui`, talks to its host only over
the `ui/*` bridge, and returns a text result from every tool, for hosts without
MCP Apps. `openai/*` fields are optional and never required.

**Publishing.** An extension is published to npm as `@nessalabs/<name>`: its
server, its app built into one self-contained HTML file, and a `bin`, so
`npx @nessalabs/<name>` runs it as a stdio MCP server; streamable HTTP is
offered for hosts that only connect to remote servers, such as ChatGPT. The packages under
`packages/` are bundled into each extension rather than published: an app must
be one self-contained file anyway, and bundling keeps an installed extension
free of versions to line up. Everything is `private` until the first extension
brings its release workflow; nothing publishes from a pull request.

**Checks.** TypeScript strict, ESLint with typescript-eslint, Prettier, and
Vitest, configured as nessa-agent's are where the two repositories have the same
needs; the architecture check in bare Node with no dependencies, which CI holds
it to by running it before `pnpm install`. CI runs all of them on every pull
request and on `main`, in one job. nessa-agent's own lint rules, such as
`nessa/inherited-lookups`, are not copied here: a second copy of a rule's
enforcer is gate 13's defect too, so until the rule is shared, what it enforces
is held here by review. `main` is protected as
every nessalabs repository is: conversations resolved before merge.

**`nessa_ui` arrives with #2, not here.** The app shell is the first code that
imports it (#2 maps host context onto its theme tokens). Pinning it now would
mean a second copy of nessa-agent's 146-line vendoring script, and a pin
nothing reads — a claim nothing checks. #2 brings the pin and decides whether
to copy that script or share it.

## Alternatives considered

- **Extensions inside nessa-agent**, under `packages/`. Simpler to start, but
  one lockfile, one release, and one review scope with the app, and nothing but
  discipline keeps the app from importing them.
- **A standards document of this repository's own.** Faster to tailor, but two
  documents drift, and the second would be a copy of the first on day one.
- **Publishing `app-shell` and `server-kit` to npm.** Useful once someone
  outside this repository builds on them; until then it is versions to keep in
  step with no one to benefit. It can be revisited with its own issue.
- **One package per extension side** (`@nessalabs/<name>-server` and an app
  package). The app is useless without its server, which serves it; two
  packages would only be installed together.

## Consequences

- An extension is testable without Nessa (in #2's fake host) and runs in any
  MCP Apps host.
- Anything an extension needs from the conversation must come through the
  bridge; ADR 344 records what that rules out for now.
- The standards are one link away rather than one directory away, and a change
  to them for extensions is a nessa-agent pull request.
- The architecture check covers dependencies only, and cannot see a path
  assembled at run time or one written without quotes (a CSS `url(../x)`, an
  unquoted HTML attribute). Everything else in `AGENTS.md`'s extensions
  section is held by review — including, until the first extension gives
  `server/` and `app/` a configuration each, that server code does not use
  browser globals or app code Node's.
- Remaining work: #2 and #3 (the packages, with `nessa_ui`), #4–#7 (the
  experiments extension and its release workflow); the `@nessalabs` npm scope
  must be held by Nessa Labs before anything is published.
