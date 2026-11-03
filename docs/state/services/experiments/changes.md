---
id: "ext-changes"
title: "Inspect cases and changes"
kind: "feature"
status: "implemented"
summary: "Run detail shows the evaluation cases and change the source recorded. A case summary describes counts and a bounded moved-case page; it is not the complete contents of every evaluated case. A file list describes changes, not a local checkout owned by this app."
parent: "ext-experiments"
sources: ["extensions/experiments/app/case-results.tsx", "extensions/experiments/app/change-view.tsx", "extensions/experiments/app/use-change.ts", "extensions/experiments/app/reading.ts", "extensions/experiments/model/experiment.ts", "extensions/experiments/model/slice.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Inspect cases and changes

Run detail shows the evaluation cases and change the source recorded. A case summary describes counts and a bounded moved-case page; it is not the complete contents of every evaluated case. A file list describes changes, not a local checkout owned by this app.

The model checks case totals, slice coherence, unique moved IDs, moved counts and the page bound before the view draws them. The UI uses the supplied summary and signals omitted entries. It does not invent missing examples. A run without a change has no change section to open.

The changed-file list is virtualized, so only visible rows need to exist in the DOM even when thousands of files are recorded. Find a file performs a trimmed, case-insensitive path substring filter. Changing experiment or run clears that query in the render that changes identity, preventing the new run from briefly inheriting the old filter. Opening the whole change and opening one file use separate targets under the same [file-opening owner](opening.md).

Added/removed totals come from the recorded files. Their Number sums are exact only while below 2^53; the record does not bound the number of files to prove an unlimited exact sum. No action here stages, patches or restores a file. Those operations would require another implementation and host authority.
