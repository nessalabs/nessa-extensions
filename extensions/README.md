# Extensions

Each directory here is one extension: an MCP server with an MCP App, published
as one npm package, `@nessalabs/<name>`. The first is
[experiments](experiments) (#4–#7): its model, its `server/`, and its `app/`.

```
extensions/<name>/
  package.json     "name": "@nessalabs/<name>", its "bin", and the packages it declares
  tsconfig.json    extends ../../tsconfig.base.json
  vite.config.ts   its build: the app's HTML file and the server
  README.md        what it does, its tools, and what each tool's view shows
  server/          the MCP server, built on @nessalabs/server-kit
  app/             the MCP App, built on @nessalabs/app-shell
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
- An extension's code comes from its own folder, the workspace packages its
  manifest declares, and npm — never another extension. What two share
  belongs in a package under [`packages/`](../packages): logic in
  `@nessalabs/common`, UI in `nessa_ui`. The typecheck, build, and test guards hold
  that (see [AGENTS.md](../AGENTS.md#layout)). A tool that needs a declared
  package's files, such as Tailwind's `@source`, reaches them through
  `node_modules` (`@source "../node_modules/@nessalabs/app-shell/src"`).
- `pnpm build` runs each extension's `vite.config.ts` in a copy of the
  repository holding only the extension, the packages it declares, pnpm's
  store, and `tsconfig.base.json`. So the extension declares what its
  configuration imports, Vite and its plugins included, and a configuration
  shared from the repository's root is not there. The build's output is the
  extension's `dist`, copied back only when it passes.
- One `tsconfig.json` types both sides of an extension, so nothing yet stops
  `server/` using `window` or `app/` using `process`; that is held by review
  until the first extension gives each side a configuration of its own, which
  `pnpm typecheck` must then check as it checks the extension's.

Tests sit beside the code they test (`*.test.ts`, `*.test.tsx`), and `pnpm test` finds them.

Adding one: open its issue first, add the directory with its `package.json`,
`README.md`, `server/`, and `app/`, and add it to the table in the repository
[README](../README.md#extensions).
