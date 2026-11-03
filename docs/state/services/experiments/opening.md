---
id: "ext-opening"
title: "Open a changed file"
kind: "statechart"
status: "implemented"
summary: "Clicking a changed file asks the source how it can be opened, then
  asks the host to open a supported link. The current sample source returns an
  unavailable reason. A server download description is valid protocol data, but
  this app refuses it because it does not implement a download surface."
parent: "ext-experiments"
sources:
  [
    "extensions/experiments/app/open-file.ts",
    "extensions/experiments/app/use-open-file.ts",
    "extensions/experiments/app/use-host.ts",
    "extensions/experiments/app/host-data.ts",
    "extensions/experiments/app/use-open-file.test.tsx"
  ]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
diagramDetails:
  [
    { "diagram": 0, "node": "Retired", "section": "What retirement prevents" },
    { "diagram": 0, "node": "Opened", "section": "What a result means" },
    { "diagram": 0, "node": "Refused", "section": "What a result means" }
  ]
model: { "spec": "tla/FileOpening.tla", "config": "tla/FileOpening.cfg" }
modelCheck:
  sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
  checker: tlc-1.7.4
  date: 2026-11-03T09:36:36.320Z
  config: tla/FileOpening.cfg
  modelDigest: 65031a0a76901728315270091896d7136c2fe653792031e4b6f3460b7d1b7478
  states: 924
  held:
    - CurrentGenerationOnly
    - LatestTargetOnly
    - MountedOnly
  broke: []
  unchecked: []
---
# Open a changed file

Clicking a changed file asks the source how it can be opened, then asks the host to open a supported link. The current sample source returns an unavailable reason. A server download description is valid protocol data, but this app refuses it because it does not implement a download surface.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Pending: Click target
  Pending --> Pending: Retry same target replaces request
  Pending --> Opened: Current link request acknowledged
  Opened --> Idle: Clear current request
  Pending --> Refused: Source unavailable or unsupported or host refuses
  Pending --> Retired: Run changes or hidden or unmounted or superseded
  Refused --> Idle: Current refusal timer expires
  Refused --> Pending: Retry
```

## What retirement prevents

Each file target and the whole-change target has its own latest request. The owner requires the component to remain mounted, the request version to match and the request to remain latest for its target. That version, called a generation in the code, increments when the experiment, run or active/hidden status changes. This resets the request machine, so hiding the view retires its earlier requests. A newer request retires the old request for that target; a different target may proceed concurrently. Old completions and old four-second refusal timers cannot overwrite newer state.

The open port carries a callback, called the current predicate, that checks whether the request still belongs to this mounted view and target. Pagination consults it before asking for another page, and the host adapter checks it again before `openLink`. Thus a stale final answer cannot initiate a new link request. Once a link request has already been sent, hiding the view or changing runs cannot undo the host's action. A local failure or cancellation is not evidence that nothing opened.

## What a result means

The request sends the selected experiment, run and optional path. On return, the app checks that the local request is still current, then validates the opening shape and HTTP(S) URL. It does not compare echoed experiment, run or path fields in the response. Local request ownership therefore does not prove that a returned URL names the requested resource. Links also require the host's openLinks capability. Host refusal stays visible. An unavailable result explains why no link is available; a download result says this app cannot offer that download. An acknowledged opening clears the request back to idle; Opened in the chart is the operation outcome, not a persistent success indicator. The refusal timer clears only the current notice, not a remote operation. Retrying begins a fresh source read; there is no automatic retry loop.

The selected model covers two targets, replacement/generation and actual link-effect admission. It will not claim to cancel an issued host action or prove browser navigation succeeds.
