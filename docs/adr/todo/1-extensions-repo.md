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
manifest. `pnpm architecture` enforces it, in bare Node before install, by
pinning the layout and checking dependencies within it:

- **The install layout is pinned.** `pnpm-workspace.yaml` may hold only
  `packages`, `allowBuilds`, and `verifyDepsBeforeRun`, and `packages` is
  exactly `packages/*` and `extensions/*`. No `.npmrc` or pnpmfile may exist
  at the root or in a unit. Every setting that moves where packages install
  or how they link is refused by not being allowed.
- **Dependencies are checked within it.** A `package.json` may hold only the
  keys on an allow-list (no `pnpm`, `resolutions`, `overrides`,
  `dependenciesMeta`); every dependency is `workspace:*` (or `^`, `~`), a
  semver range, or a dist-tag — never a path, tarball, URL, `file:`, `link:`,
  `portal:`, `workspace:<path>`, `npm:` alias, or `catalog:`; and none is
  named for an extension. In the pinned layout pnpm links into a unit exactly
  the workspace packages its manifest names, so an extension no manifest
  names is installed nowhere, and an import of one by name fails typecheck and
  test.
- **Files do not reach another unit**: no quoted relative path in any file of
  an extension or a package leads into another unit (it may leave for the
  root's shared configuration or a build directory), and no symbolic link
  sits in a unit.

This is the owner's decision after five review rounds. Checking how a
dependency was written, then the lockfile, then the install, each fell to a
pnpm setting that moved the outcome somewhere the check did not look. Pinning
the settings takes those away, so what remains to check is the manifest; the
lockfile and the install are not read, since they would re-decide what the
manifest check decides.

Held by review, not by the check: pnpm settings from outside the repository
(a user's `~/.npmrc`, `npm_config_*` environment variables; CI sets none),
a registry package that depends on a published extension, and a path
assembled at run time or written without quotes. The two module comments,
`scripts/architecture/layout.mjs` and `dependencies.mjs`, are the one
statement of what is checked.

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
needs; the architecture check in bare Node with no dependencies, which CI
holds it to by running it before `pnpm install`. CI runs all of them on every pull
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
- The architecture check covers the layout and dependencies only, as the
  record states above. Everything else in `AGENTS.md`'s extensions section is
  held by review — including, until the first extension gives
  `server/` and `app/` a configuration each, that server code does not use
  browser globals or app code Node's.
- Remaining work: #2 and #3 (the packages, with `nessa_ui`), #4–#7 (the
  experiments extension and its release workflow); the `@nessalabs` npm scope
  must be held by Nessa Labs before anything is published.
