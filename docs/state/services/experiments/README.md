---
id: "ext-experiments"
title: "Read an experiment"
kind: "service"
status: "implemented"
summary: "An experiment view shows what a harness reported: its metric, best version, attempts, guardrails and changed files. The current server supplies samples. The view does not start workers, accept a candidate or recompute which run is best."
parent: "nessa-extensions"
sources: ["extensions/experiments/app/main.tsx", "extensions/experiments/app/experiment-app.tsx", "extensions/experiments/app/surface.tsx"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Read an experiment

An experiment view shows what a harness reported: its metric, best version, attempts, guardrails and changed files. The current server supplies samples. The view does not start workers, accept a candidate or recompute which run is best.

Open the inline card into the full view when the host offers it. [Display and snapshot replacement](display.md) explains why the host may keep the card inline and what changes when a new result arrives. In the full view, [overview and areas](overview.md) explain the charts and current work; [runs and lineage](runs.md) covers filtering and navigation; [cases and changes](changes.md) covers detailed evidence. [Opening files](opening.md) explains refusals and stale requests.

The [validated record](records.md) supplies the meaning of scores and verdicts. [Server reads](data.md) and [continuation pages](paging.md) explain where data comes from and why a changing source can refuse a large read. These owners are separate: a valid record is not a running experiment, and a successful link request is not an edit to the experiment.
