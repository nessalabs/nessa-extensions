---
id: "ext-display"
title: "Open and replace the view"
kind: "operation"
status: "implemented"
summary: "The card asks the host for fullscreen and renders the mode the host actually applies. A host may keep it inline and open another view itself; a different returned mode is not automatically a refusal. An explicitly unavailable mode is refused locally and a rejected request produces a visible notice."
parent: "ext-experiments"
sources: ["extensions/experiments/app/experiment-app.tsx", "extensions/experiments/app/use-host.ts", "extensions/experiments/app/host-data.ts", "extensions/experiments/app/experiment-app.test.tsx"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Open and replace the view

The card asks the host for fullscreen and renders the mode the host actually applies. A host may keep it inline and open another view itself; a different returned mode is not automatically a refusal. An explicitly unavailable mode is refused locally and a rejected request produces a visible notice.

An opening tool result with a valid experiment becomes the displayed snapshot. When a complete text-only result supplies an experiment ID, the app recovers its record through `get_experiment`. Missing IDs, malformed results, cancellation and connection failures have visible states rather than fabricated empty experiments. While a new snapshot is being recovered, the prior snapshot may remain on screen, but opening a run is disabled so it cannot start against the snapshot being replaced.

Every accepted new experiment object advances the displayed snapshot token, even if its ID is unchanged. The full view is keyed by that token and starts again at Overview. Recovery is tied to opening result identity, so a later result for the same ID is a new read. Display-mode rerenders of the same accepted object do not by themselves reread it.

The card and full view remain mounted while hidden according to display mode. Reads are gated by active view and owning identity; retaining hidden content is not a promise of background freshness. Back asks for inline mode. Escape closes an open run in the full view, not the full view itself. See [runs](runs.md) for editable-field and lineage behavior.
