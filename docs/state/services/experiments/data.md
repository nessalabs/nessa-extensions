---
id: "ext-data"
title: "Read data through tools"
kind: "operation"
status: "implemented"
summary: "The experiments server reads and validates its source for each request. It never trusts a source merely because it implements the TypeScript interface. A request for one experiment cannot quietly receive another experiment's record."
parent: "ext-experiments"
sources: ["extensions/experiments/server/extension.ts", "extensions/experiments/server/reading.ts", "extensions/experiments/server/source.ts", "extensions/experiments/server/result-bound.ts", "extensions/experiments/server/text.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Read data through tools

The experiments server reads and validates its source for each request. It never trusts a source merely because it implements the TypeScript interface. A request for one experiment cannot quietly receive another experiment's record.

| Tool | Current role and visibility |
| --- | --- |
| show_experiment | Model/app opening tool with a view; text always stands alone. |
| get_experiment | App-only full snapshot read with a view. |
| list_runs | App-only newest-first run list with a view. |
| get_run | App-only full detail for a run in the experiment. |
| open_file | Model/app read of how to open a recorded change or path; no view attachment. |

Every tool declares read-only effects. `open_file` asks the source for an opening description; the app separately asks its host to open a permitted link. The annotation is not proof that an arbitrary injected source is side-effect-free.

An absent experiment causes a checked ID-list read. If that list claims the missing ID exists, the source is contradictory and fails. Invalid records, mismatched IDs and unknown runs are refused. File paths must belong to the run's recorded change. Link openings must be HTTP(S); download descriptions and unavailable reasons are validated too.

`show_experiment` omits structured data over 16,384 bytes while keeping text, allowing the app to recover through `get_experiment`. The other four tools use [continuation pages](paging.md) for large answers. Diagnostic text is bounded and made well-formed; truncation is explicit. This bounds wire messages, not all memory use. The current sample source has no actual changed files to open; a real harness is an injected integration, not a feature hidden in the app.
