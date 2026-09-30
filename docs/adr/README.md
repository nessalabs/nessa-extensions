# Architecture decision records

Records here follow
[nessa-agent's ADR index](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/README.md):
its folders, its status, and its
[numbering rule](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/README.md#numbering-open-the-issue-first),
with the issue opened in this repository. A decision about Nessa itself — the
app, the gateway, the host — is recorded in nessa-agent, not here.

nessa-agent's check for a number used twice is not copied here; with numbers
taken from issues, only a typo can repeat one, and review catches it.

## Todo

| ADR | Remaining work |
| --- | --- |
| [1 — The extensions repository](todo/1-extensions-repo.md) | Proposed: a separate repository of MCP servers with MCP Apps, held to nessa-agent's standards; `packages/` and `extensions/<name>/{server,app}`; an extension published as `@nessalabs/<name>`. Remaining: the packages (#2, #3), the first extension (#4–#7), `nessa_ui` from #2, and the release workflow with the first extension |
