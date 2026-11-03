---
id: "ext-app-shell"
title: "Connect an embedded app"
kind: "service"
status: "implemented"
summary: "The app shell connects an iframe to the host that opened it. It owns the bridge connection and typed replies, not a direct network connection to the extension server. Applications must show connection and request failures."
parent: "nessa-extensions"
sources: ["packages/app-shell/src/index.ts", "packages/app-shell/src/react/index.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Connect an embedded app

The app shell connects an iframe to the host that opened it. It owns the bridge connection and typed replies, not a direct network connection to the extension server. Applications must show connection and request failures.

Use [connection and teardown](connection.md) to decide when work may be sent; [requests and cancellation](requests.md) to interpret a refused or abandoned call; and [opening tool notifications](tool-call.md) to read the input and result that opened the view. [React, size and theme](presentation.md) covers mounting and following host context. [Development hosts](../../development.md) explains the fake host and reference-host fixtures.

`mountApp` creates the bridge, mounts a provider, starts size observation and calls connect. `BridgeProvider` by itself supplies an existing bridge and does not connect it. Framework-free consumers can use the main entry without React. The `/build` and `/fake-host` entries are separate development surfaces.
