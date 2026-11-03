---
id: "ext-transports"
title: "Choose a serving transport"
kind: "operation"
status: "implemented"
summary: "The current experiments executable serves stdio. Integrators can separately call server-kit's loopback HTTP API, which is deliberately limited to local clients. Neither entry is an authenticated public internet deployment recipe."
parent: "ext-server-kit"
sources: ["packages/server-kit/src/transports.ts", "packages/server-kit/src/transports.test.ts", "packages/server-kit/src/testing.ts", "extensions/experiments/server/main.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Choose a serving transport

The current experiments executable serves stdio. Integrators can separately call server-kit's loopback HTTP API, which is deliberately limited to local clients. Neither entry is an authenticated public internet deployment recipe.

Stdio uses the SDK serving lifecycle and supports the protocol eras selected there. HTTP creates fresh server instances through the SDK factory and supports the modern era; legacy HTTP requests are refused. Binding is restricted to 127.0.0.1 or ::1, with host/origin validation and the configured request path checked before serving. The returned serving handle exposes shutdown; an external caller owns when to close it.

A tool receives the SDK request AbortSignal. Passing that signal into a source is cooperative cancellation, not forced termination of arbitrary work. Tool code can have performed effects before throwing or before a connection closes. Transport shutdown does not turn an error into evidence of rollback.

The `/testing` helpers open disposable stdio/HTTP clients for tests. They are fixtures, not extra product endpoints. Tests cover transport refusal and session/request behavior. The current bin has no HTTP flag, port configuration or remote deployment path; using HTTP requires explicit composition with `serveOverHttp`.
