---
id: "ext-requests"
title: "Interpret host requests"
kind: "operation"
status: "implemented"
summary: "A host request has a local pending reply, identified by its JSON-RPC request ID. A resolved call means the expected reply was received and checked; it does not grant every kind of permission or establish that remote work can be undone."
parent: "ext-app-shell"
sources: ["packages/app-shell/src/bridge/bridge.ts", "packages/app-shell/src/bridge/failures.ts", "packages/app-shell/src/protocol/transport.ts", "packages/app-shell/src/protocol/narrow.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Interpret host requests

A host request has a local pending reply, identified by its JSON-RPC request ID. A resolved call means the expected reply was received and checked; it does not grant every kind of permission or establish that remote work can be undone.

| Operation | What the caller must interpret |
| --- | --- |
| `callTool` | The returned tool result can contain `isError: true`; this is not automatically a rejected bridge Promise. |
| `readResource` | A checked resource reply or a typed bridge failure. |
| `sendMessage`, `openLink`, `updateModelContext` | Refused acknowledgements reject; show the refusal. |
| `requestDisplayMode` | Follow the mode the host actually returned, which may differ from the requested mode. |
| Size and log notifications | No success reply; unsupported or closed cases follow the bridge's notification contract. |

Aborting `CallOptions.signal` stops the local wait. It sends no cancellation message to the host and cannot reverse a tool effect or a link already opened. One late reply for that abandoned ID is ignored; a duplicate after that is an unknown-response violation. Closing the bridge also rejects local waits. Neither result is evidence that the remote work stopped, so retry safety depends on the operation.

Malformed replies and protocol violations are narrowed at the bridge boundary. Subscriber notification is batched in a microtask; a throwing subscriber is reported without preventing the remaining subscribers. The window transport accepts only messages whose source is its current peer window. It posts to `*` because a sandboxed peer may have an opaque origin; this is a peer-window check, not an origin allow-list. Host authentication and sandbox policy remain external.
