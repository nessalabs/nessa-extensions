# @nessalabs/app-shell

What an extension's MCP App is built on, in the browser. The app is HTML that
a host renders in a sandboxed iframe; this package is how it talks to that host
and how it is built into the one HTML file the host is given.

Its job, built in [#2](https://github.com/nessalabs/nessa-extensions/issues/2):

- **A typed client for the `ui/*` bridge:** the `ui/initialize` handshake,
  the tool's input and result as the host sends them, `tools/call` and
  `resources/read` back through the host, `ui/message`,
  `ui/update-model-context`, `ui/request-display-mode`, `ui/open-link`, size and
  host-context changes, and teardown.
- **React bindings** over it, with the host context mapped onto `nessa_ui`'s
  theme tokens, so an app looks native in Nessa and follows the host's theme
  elsewhere.
- **Bundling** an app into one `text/html;profile=mcp-app` resource.
- **A fake host** for tests, which plays the standard's message sequence.

Until then it is empty, and its test says so. It is private: an extension's
build bundles it into the app (see the
[repository's decision record](../../docs/adr/todo/1-extensions-repo.md)).
