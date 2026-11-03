---
id: "ext-overview"
title: "Read progress and areas"
kind: "feature"
status: "implemented"
summary: "Overview compares the reported best version with the baseline, shows the climb over time, the path of kept versions, active agents and notes. Areas adds the exploration map and area cards when the experiment defines areas; a comparison with no areas omits that tab."
parent: "ext-experiments"
sources: ["extensions/experiments/app/overview.tsx", "extensions/experiments/app/areas-page.tsx", "extensions/experiments/app/use-climb.ts", "extensions/experiments/app/use-map.ts", "extensions/experiments/app/reading.ts", "extensions/experiments/app/page-reading.ts", "extensions/experiments/model/selections.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Read progress and areas

Overview compares the reported best version with the baseline, shows the climb over time, the path of kept versions, active agents and notes. Areas adds the exploration map and area cards when the experiment defines areas; a comparison with no areas omits that tab.

The climb includes settled runs with a primary-split score, ordered by settlement time then run number. Its best line follows `bestSoFar`, starting with the baseline only once the baseline has a score. A missing score is not zero. Hover reveals the run's reported verdict, reason and related labels; selecting an available run opens its detail.

The path to best follows the harness's kept sequence. It is different from a run's parent lineage, which explains what that particular attempt was built on. The map places runs in their areas and draws the best-so-far thread; a run without an area has no map dot. Area colors, labels and glyphs come from the validated definition, with geometry computed for the measured view size.

Metric units, decimal precision, direction and noise come from the definition. The view formats them through the shared model formatter. It does not choose a winner by visually highest score: latency can be better when lower, and the harness's verdict remains authoritative. Guardrails, notes and agent activity describe the snapshot, not live subscriptions to workers.
