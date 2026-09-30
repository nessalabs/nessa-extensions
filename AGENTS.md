# Working in nessa-extensions

nessa-agent's [CODING_STANDARDS.md][standards] is the coding standards
document for this repository too. Every rule lives there, and nessa-agent's
[AGENTS.md][agents] says which of them apply when. Both apply here unchanged.
This file restates none of them. It adds only what is specific to extensions,
in the section below: the layout, conformance to MCP Apps, the sandbox an app
runs in, publishing, and where work is tracked.

That is [gate 13][gates] applied to documentation: a rule written in two places
is two rules, and they drift — across two repositories faster than across two
files. If you find a rule stated both here and in the standards, the standards
document is the owner and the copy here is the defect. Delete the copy rather
than reconciling it. If a rule there needs to change for extensions, change it
there, in a nessa-agent pull request.

Read [CODING_STANDARDS.md][standards], nessa-agent's [AGENTS.md][agents], this
repository's [README](README.md), and its
[decision record](docs/adr/todo/1-extensions-repo.md) before making changes.
Where a rule there names something only nessa-agent has — Rust crates, the
`nessa-sdk`, the gateway, `src-tauri`, the desktop window — it has no
counterpart here. Everything else applies as written: the gates, organization,
domain-driven design, seams at the process boundary, one current contract,
tables read for what they own, browser verification for UI, the review loop,
and evidence and closure.

## Extensions

### Layout

```
packages/
  app-shell/     the browser side: the ui/* bridge client, host theming, the fake host (#2)
  server-kit/    the server side: tools with UI, ui:// resources, negotiation (#3)
extensions/
  <name>/        one extension, one npm package: @nessalabs/<name>
    server/      its MCP server
    app/         its MCP App, built into one HTML file the server serves
scripts/         developer tooling: the architecture check
docs/adr/        decision records
```

- An extension depends on nothing in another extension, and a package on
  nothing in any extension. What two extensions share goes in a package.
  Another unit is reached only by package name, through a manifest.
  Two checks hold that. `pnpm architecture` (`scripts/check-architecture.mjs`,
  before install): no quoted relative path in an extension's or a package's
  files leads into another unit, and no symbolic link sits in one.
  `pnpm architecture:installed` (`scripts/check-installed.mjs`, after
  install): no `node_modules` outside an extension holds a link into it or a
  copy of a package from it, however the dependency was written. A unit
  resolves by name only what is installed for it or the root, so an import of
  an extension by name fails typecheck and test.
  The check's module comment lists what it cannot see. That is the whole of
  what is checked mechanically; the rest of this section is held by review.
- An extension's own layout, below `server/` and `app/`, follows the standards'
  [organization][organization] and [domain-driven design][ddd] sections, and is
  described in [extensions/README.md](extensions/README.md).

### MCP Apps conformance

An extension is an MCP server with an MCP App, as specified by
[MCP Apps][spec] (`io.modelcontextprotocol/ui`, SEP-1865). It is written to the
standard, not to Nessa: it works unchanged in any MCP Apps host, and Nessa
hosts it as any other ([nessa-agent ADR 344][adr-344], proposed in
[nessa-agent#350](https://github.com/nessalabs/nessa-agent/pull/350)).

- **Negotiation.** The server declares UI only when the client's
  `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes` includes
  `text/html;profile=mcp-app`.
- **Tools.** A tool with UI names its view in `_meta.ui.resourceUri` (a
  `ui://` URI) and who may call it in `_meta.ui.visibility`. A tool the app
  calls lists `"app"`. Its `readOnlyHint` and `destructiveHint` annotations
  say what it changes; a host uses them to decide when to ask the person first
  (Nessa does, per ADR 344).
- **Resources.** The view is a `ui://` resource of type
  `text/html;profile=mcp-app`, read with `resources/read`, whose `_meta.ui`
  declares its CSP domains and permissions.
- **The bridge.** The app speaks to its host only through the `ui/*` JSON-RPC
  bridge over `postMessage`, through `@nessalabs/app-shell`. It begins with
  `ui/initialize` and `ui/notifications/initialized`; then come the tool's
  input and result, `tools/call` and `resources/read` on its own server,
  `ui/message`, `ui/update-model-context`, `ui/request-display-mode`, and
  `ui/open-link`.
- **Text fallback.** Every tool with UI also returns a text result that stands
  on its own, for a host without MCP Apps and for the model.
- **Optional host fields.** `openai/*` fields may be read when present; an app
  never requires them.

### What an app may assume about its sandbox

- It runs in a sandboxed iframe, isolated from the host — on a web host,
  behind a sandbox proxy on another origin. It has no access to the host's DOM,
  storage, cookies, or APIs.
- **No network** unless the resource declares it in `_meta.ui.csp`:
  `connectDomains` for fetch, XHR, and WebSocket; `resourceDomains` for
  scripts, styles, images, fonts, and media; `frameDomains` for nested iframes.
  With nothing declared, the spec's default CSP allows scripts, styles,
  images, and media only from the app's own document (`'self'`, inline, and
  `data:` for images and media), fonts and connections from nowhere. So the
  app's HTML carries its scripts and styles inline, and a font the app needs
  comes from an origin it declares in `resourceDomains`; otherwise it uses
  what the host offers in `styles.css.fonts`, if the host's policy lets it
  load, or the system's fonts.
- Its data comes from its host: the tool's input and result, and `tools/call`
  and `resources/read` on its own server, through the bridge — plus whatever
  it fetches from a `connectDomains` origin. It never assumes it can reach its
  server any other way.
- A permission (camera, microphone, clipboard, and so on) is requested in
  `_meta.ui.permissions` and still feature-detected; a host may refuse it.
- The host context — theme, style variables, locale, display mode, size — may
  be partial and may change while the app runs. The app keeps its own defaults
  for what is missing and follows changes.
- A host may refuse any request: a display mode, a link, a message, a tool
  call. The app shows the refusal; it does not assume success. This is the
  standards' gate 7, "degrade honestly".

### Browser verification

The standards' [browser verification][browser] and gate 17 apply to an app as
to any UI: its scripts drive it in Chromium and WebKit, inside the fake host
from `@nessalabs/app-shell` (#2) rather than the desktop window.

### Publishing

Each extension is published to npm as `@nessalabs/<name>`, runnable as a stdio
MCP server with `npx @nessalabs/<name>` and over streamable HTTP.
The app is built into the package, and the packages under `packages/` are
bundled into it. The [README](README.md) shows how to add one to a host. What
publishes, and when, is in the [decision record](docs/adr/todo/1-extensions-repo.md);
nothing publishes from a pull request.

### Decision records

A record takes its GitHub issue's number here as in nessa-agent — an issue in
_this_ repository. See [docs/adr/README.md](docs/adr/README.md).

### Tracking work on the project board

The standards' [tracking section][tracking] applies with one change: this
repository's issues are on the
[Nessa Extensions project](https://github.com/orgs/nessalabs/projects/2)
(project 2), which has the same **Status** field and flow. In the lookup there,
use `name:"nessa-extensions"` and project number 2.

[standards]: https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md
[agents]: https://github.com/nessalabs/nessa-agent/blob/main/AGENTS.md
[gates]: https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#gates
[organization]: https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#organization-across-the-repository
[ddd]: https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#domain-driven-design-boundaries
[tracking]: https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#tracking-work-on-the-project-board
[browser]: https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#browser-verification-for-ui
[spec]: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
[adr-344]: https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/todo/344-mcp-ui.md
