# Architecture decision records

Folders show implementation progress; the `Status` inside a record shows whether
its decision is proposed, accepted, or superseded. Acceptance alone does not
make an implementation done.

- **`todo/`** — proposals and decisions with implementation remaining.
- **`done/`** — implemented decisions, keeping their numbers and filenames.

## Numbering: open the issue first

**A record takes the number of the issue in this repository that proposed it.**
Open the issue, then write `todo/<issue>-<slug>.md`. This is nessa-agent's rule,
for nessa-agent's reason, which
[its ADR index](https://github.com/nessalabs/nessa-agent/blob/main/docs/adr/README.md#numbering-open-the-issue-first)
gives: GitHub hands out issue numbers one at a time to everybody, so two
branches cannot give two records one number. A decision about Nessa itself —
the app, the gateway, the host — is recorded in nessa-agent, not here.

## Todo

| ADR | Remaining work |
| --- | --- |
| [1 — The extensions repository](todo/1-extensions-repo.md) | Proposed: a separate repository of MCP servers with MCP Apps, held to nessa-agent's standards; `packages/` and `extensions/<name>/{server,app}`; an extension published as `@nessalabs/<name>`. Remaining: the packages (#2, #3), the first extension (#4–#7), `nessa_ui` from #2, and the release workflow with the first extension |
