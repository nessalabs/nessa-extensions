---
id: "ext-verification"
title: "Evidence and limits"
kind: "guide"
status: "implemented"
summary: "This atlas reviews source 47cb6984bebc81e8930edfcafc35e7d5c214b7ec. That checkpoint identifies the implementation described; it is not proof of every external host or a deployed extension. Current checks ran on Darwin arm64 with Node 24.22.1 and pnpm 11.9.0."
parent: "nessa-extensions"
sources: ["package.json", "packages/app-shell/verification/playwright.config.ts", "extensions/experiments/verification/large.mjs"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Evidence and limits

This atlas reviews source 47cb6984bebc81e8930edfcafc35e7d5c214b7ec. That checkpoint identifies the implementation described; it is not proof of every external host or a deployed extension. Current checks ran on Darwin arm64 with Node 24.22.1 and pnpm 11.9.0.

The frozen install, architecture checks (29 tests), typecheck and build passed. The test command passed 1,024 Vitest tests across 48 files and 83 Node boundary regressions. App-shell browser verification passed 18 tests across Chromium and WebKit using fake/reference hosts.

The large experiment verifier passed both engines against the built app and real extension server: a 1,009,968-byte sample (23.34 times checkout), 422 observed calls, maximum encoded reply 41,615 bytes under 57,344, and 15 visible virtualized file rows per engine. Current captures are retained separately from historical evidence under verification/state-models. This establishes fake-host and transport behavior, not native Nessa-host acceptance or scientific validity of experiment scores.

Three selected TLA baselines passed seven invariants across 947 aggregate states, and all seven semantic negative controls failed their intended rule with no unchecked result. They check bounded design rules rather than execute TypeScript. [Exact receipts](../../verification/state-models/results.json), [controls](../../verification/state-models/controls.json) and [source/model review](../../verification/state-models/review.md) preserve their scope. Independent docs-only and technical review found terminology and chart-outcome issues plus an unsupported response-identity claim; these were corrected. Independent trace review closed all findings in its sampled scope. Chrome opened all 24 atlas pages and rendered five diagrams without errors; four normal chart-detail checks exposed the critical failure boundaries. [Implementation checks](../../verification/state-models/implementation-checks.json), [browser results](../../verification/state-models/browser-results.json), [chart-detail checks](../../verification/state-models/reader-browser.json) and [reader review](../../verification/state-models/reader-review.md) retain the evidence. No npm package was published and no live experiment harness was run. Historical real-gateway evidence includes a canonical jsxDEV failure and a later standalone pass; this documentation change does not resolve or relabel that acceptance history.


With a built Nessa Docs checkout and its pinned checker cache already installed, reproduce catalog/model/control checks with:

```sh
NESSA_DOCS_ROOT=/absolute/nessa-docs node scripts/state-docs/verify.mjs --write
```

The adapter imports canonical checker/catalog code. It does not install a checker or execute the modeled app. Source checkpoints are retained independently from the later documentation commit.
