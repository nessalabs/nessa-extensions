# @nessalabs/server-kit

What an extension's MCP server is built on: the server's side of MCP Apps, so
every extension declares its UI the same way.

Its job, built in [#3](https://github.com/nessalabs/nessa-extensions/issues/3):

- **Tools with UI:** `_meta.ui.resourceUri`, `_meta.ui.visibility`, and the
  `readOnlyHint` and `destructiveHint` annotations.
- **The `ui://` resource,** served as `text/html;profile=mcp-app` with its
  `_meta.ui`: `csp`, `permissions`, `domain`, `prefersBorder`.
- **Negotiation** of `io.modelcontextprotocol/ui`, with a text-only fallback
  for a host without it.
- **Transports:** stdio, which `npx @nessalabs/<name>` runs, and streamable
  HTTP.

Until then it is empty, and its test says so. It is private: an extension's
build bundles it into the published package (see the
[repository's decision record](../../docs/adr/todo/1-extensions-repo.md)).
