# Extensions

Each directory here is one extension: an MCP server with an MCP App, published
as one npm package, `@nessalabs/<name>`. There are none yet; the first is
experiments (#4–#7).

```
extensions/<name>/
  package.json   "name": "@nessalabs/<name>", its "bin", and its build
  README.md      what it does, its tools, and what each tool's view shows
  server/        the MCP server, built on @nessalabs/server-kit
  app/           the MCP App, built on @nessalabs/app-shell
```

- **`server/`** runs in Node. It declares the extension's tools and serves the
  app as a `ui://` resource. What it reads from outside the process, it reads
  behind a port, as the standards'
  [seams at the process boundary](https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#seams-at-the-process-boundary)
  describe.
- **`app/`** runs in the host's sandboxed iframe. It is built into one
  self-contained HTML file, which `server/` serves. Its data comes from its
  host — the tool's input and result, and `tools/call` and `resources/read` on
  its own server — plus any origin it declares in `_meta.ui.csp`
  (see [AGENTS.md](../AGENTS.md#what-an-app-may-assume-about-its-sandbox)).
- Code both sides need — an extension's domain model, validation, and
  formatting — sits in the extension beside them, in its own directory named
  for what it holds, and imports neither side. Its layout follows the
  standards' [organization](https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#organization-across-the-repository)
  and [domain-driven design](https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#domain-driven-design-boundaries)
  sections.
- An extension depends on nothing in another extension. What two share
  belongs in a package under [`packages/`](../packages), reached by its
  package name. `pnpm architecture` refuses a dependency the lockfile resolves
  into an extension from outside it, a quoted relative path that leads into
  another extension or package, a symbolic link, and an extension directory
  without a `package.json`. A tool that needs another unit's files, such as
  Tailwind's `@source`, reaches them through `node_modules`
  (`@source "../node_modules/@nessalabs/app-shell/src"`), not by path.
- Until the first extension, one `tsconfig.json` types every file with both
  the DOM and Node, so nothing yet stops `server/` using `window` or `app/`
  using `process`; that is held by review. The first extension gives each
  side its own configuration.

Tests sit beside the code they test (`*.test.ts`, `*.test.tsx`), and `pnpm test` finds them.

Adding one: open its issue first, add the directory with its `package.json`,
`README.md`, `server/`, and `app/`, and add it to the table in the repository
[README](../README.md#extensions).
