---
id: "ext-connection"
title: "Connect and tear down"
kind: "statechart"
status: "implemented"
summary: "An app may send normal host requests after initialization completes.
  The bridge sends the initialized notification before publishing connected
  state, so a subscriber cannot begin ordinary work before that handshake step.
  Calling connect again shares the original attempt while connecting or already
  connected; it does not reconnect a failed, closed or completed teardown
  bridge."
parent: "ext-app-shell"
sources:
  [
    "packages/app-shell/src/bridge/bridge.ts",
    "packages/app-shell/src/bridge/bridge.test.ts",
    "packages/app-shell/src/react/mount.tsx"
  ]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
diagramDetails:
  [
    { "diagram": 0, "node": "TearingDown", "section": "What teardown waits for" },
    { "diagram": 0, "node": "TornDown", "section": "What teardown waits for" },
    { "diagram": 0, "node": "Closed", "section": "What teardown waits for" }
  ]
model: { "spec": "tla/BridgeConnection.tla", "config": "tla/BridgeConnection.cfg" }
modelCheck:
  sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
  checker: tlc-1.7.4
  date: 2026-11-03T09:36:32.972Z
  config: tla/BridgeConnection.cfg
  modelDigest: 1f73c4d3206037a4a2c885da246a9e4b19d7845f255a61c0e2ed78910f50afc4
  states: 13
  held:
    - InitializedBeforePublication
    - NoLateRevival
  broke: []
  unchecked: []
---
# Connect and tear down

An app may send normal host requests after initialization completes. The bridge sends the initialized notification before publishing connected state, so a subscriber cannot begin ordinary work before that handshake step. Calling connect again shares the original attempt while connecting or already connected; it does not reconnect a failed, closed or completed teardown bridge.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Connecting: connect
  Connecting --> Connected: Valid initialize reply and initialized sent
  Connecting --> Failed: Refusal or invalid reply or send failure
  Idle --> TearingDown: Host teardown
  Connecting --> TearingDown: Host teardown
  Connected --> TearingDown: Host teardown
  TearingDown --> TornDown: All handlers settle
  Idle --> Closed: close
  Connecting --> Closed: close
  Connected --> Closed: close
  Failed --> Closed: close
  TearingDown --> Closed: close
  TornDown --> Closed: close
```

## What teardown waits for

The bridge waits for all registered teardown handlers with `Promise.allSettled`. There is no timeout. If a handler never settles, teardown remains waiting. If a handler rejects, a tearing-down bridge still enters torn-down state and answers the host with an error. A bridge already closed stays closed; an already failed bridge retains its failure. A successful acknowledgement establishes handler settlement, not a universal guarantee that outside work stopped.

Handlers may call through the bridge during teardown only when that bridge had already connected. Teardown before initialization does not grant permission to send. A late initialize reply cannot revive a bridge after teardown or close. `close()` removes transport listening and rejects pending local requests; mountApp's unmount also stops size observation and unmounts React. It is not the host's asynchronous teardown protocol.

## Model boundary

The selected bounded model checks handshake publication and late-initialize admission. It will not prove handler completion, host cleanup, transport delivery or React ordering. Existing bridge and conformance tests exercise those concrete adapters within their fixtures.
