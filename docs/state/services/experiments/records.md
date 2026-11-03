---
id: "ext-records"
title: "Understand validated records"
kind: "contract"
status: "implemented"
summary: "An Experiment is a validated immutable snapshot, not a mutable job controller. The harness supplies verdicts and `bestSoFar`; the model checks that they agree internally and the view reads them. Validation does not establish that a reported measurement was scientifically correct."
parent: "ext-experiments"
sources: ["extensions/experiments/model/index.ts", "extensions/experiments/model/definition.ts", "extensions/experiments/model/experiment.ts", "extensions/experiments/model/validation.ts", "extensions/experiments/model/metric.ts", "extensions/experiments/model/selections.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Understand validated records

An Experiment is a validated immutable snapshot, not a mutable job controller. The harness supplies verdicts and `bestSoFar`; the model checks that they agree internally and the view reads them. Validation does not establish that a reported measurement was scientifically correct.

The parser makes a fresh frozen copy, then checks cross-field rules on that copy. These include unique identities, resolvable references, earlier parents, time ordering, progress/count coherence, valid slices, unique file paths and agreement between kept runs and the best sequence. Shape failure prevents those cross-field readers from running; the result reports problems with rule names and paths. Hostile JavaScript inputs whose getters throw can still throw during parsing; server/app boundaries must handle those failures.

Definitions provide metric names, split labels, verdicts, units, direction, precision and guardrail limits. Exact decimal rounding uses the number's shortest round-trip digits and BigInt arithmetic, rounding half away from zero. A displayed change is computed between its two values with the appropriate metric noise, while guardrail changes do not reuse the experiment metric's noise. Relative guardrails require a baseline measurement.

The model contains baseline, runs, scores, cases, changes, areas, agents, activity, notes and progress. These are data contracts tested through validation, formatting and selection suites. They do not need artificial TLA lifecycles. Samples exercise a rising score, falling latency and large dataset without changing those meanings.
