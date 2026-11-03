---
id: "ext-runs"
title: "Browse runs and lineage"
kind: "operation"
status: "implemented"
summary: "Runs lists attempts newest first and lets the reader filter by verdict. Opening a row requests that run's full detail. A displayed loading or failure state belongs to that read, not to the experiment's execution status."
parent: "ext-experiments"
sources: ["extensions/experiments/app/surface.tsx", "extensions/experiments/app/navigation.ts", "extensions/experiments/app/use-navigation.ts", "extensions/experiments/app/use-host.ts", "extensions/experiments/app/page-reading.ts", "extensions/experiments/app/runs-view.tsx"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Browse runs and lineage

Runs lists attempts newest first and lets the reader filter by verdict. Opening a row requests that run's full detail. A displayed loading or failure state belongs to that read, not to the experiment's execution status.

The app reconciles runs from the opening snapshot, the list and full-detail replies against the current experiment definition. Rejected entries are counted rather than silently treated as valid. A new experiment snapshot or selected run clears the previous detail before it can appear under the new identity. A successful read retained for the same snapshot may be reused after hiding and showing; hidden views do not promise a refreshed source.

A run opens over the selected Overview, Areas or Runs view. The underlying view stays mounted, preserving its scroll and filter. Tabs cannot switch while a run is open. Following lineage adds another run to a trail; breadcrumbs return to an earlier member. Closing the detail clears the trail and returns to the underlying view. Escape pops one run while active, but ignores inputs, textareas, selects and editable fields so their own Escape behavior can run. With no run open, Escape does not leave fullscreen.

The outcome combines verdict/reason, score changes and guardrail measures. Missing measures are shown as missing, and relative guardrail limits remain not measured until the baseline measure exists. Lineage is a parent chain, not the best-so-far path. Its reader stops at missing parents or repeated IDs defensively; it does not infer an unseen ancestor's contents.
