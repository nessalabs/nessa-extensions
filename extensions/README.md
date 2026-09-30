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
  app as a `ui://` resource. It is the only place the extension reads data from
  outside the process, behind a port the standards'
  [seams at the process boundary](https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#seams-at-the-process-boundary)
  describes.
- **`app/`** runs in the host's sandboxed iframe. It is built into one
  self-contained HTML file, which `server/` serves. It reaches its data only
  through the host: the tool's result, and `tools/call` to its own server.
- Code both sides need — an extension's domain model, validation, and
  formatting — sits in the extension beside them, in its own directory named
  for what it holds, and imports neither side. Its layout follows the
  standards' [organization](https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#organization-across-the-repository)
  and [domain-driven design](https://github.com/nessalabs/nessa-agent/blob/main/CODING_STANDARDS.md#domain-driven-design-boundaries)
  sections.
- An extension imports nothing from another extension. What two share belongs
  in a package under [`packages/`](../packages). `pnpm architecture` refuses
  it, by path and by package name, and refuses an extension directory without a
  `package.json` naming it.

Tests sit beside the code they test (`*.test.ts`), and `pnpm test` finds them.

Adding one: open its issue first, add the directory with its `package.json`,
`README.md`, `server/`, and `app/`, and add it to the table in the repository
[README](../README.md#extensions).
