---
id: "ext-transports"
title: "Choose a serving transport"
kind: "operation"
status: "implemented"
summary: "The current experiments executable serves stdio. Integrators can separately call server-kit's loopback HTTP API, which is deliberately limited to local clients. The optional remote mount uses host-owned HTTPS and token verification."
parent: "ext-server-kit"
sources: ["packages/server-kit/src/remote-http.ts", "packages/server-kit/src/remote-http.test.ts", "packages/server-kit/src/transports.ts", "packages/server-kit/src/transports.test.ts", "packages/server-kit/src/testing.ts", "extensions/experiments/server/main.ts"]
sourceRevision: "937b2043a6387ea17afa0d7068098f2c7ef8fae7"
diagramLinks: {}
---

# Choose a serving transport

The current experiments executable serves stdio. Integrators can separately call server-kit's loopback HTTP API, which is deliberately limited to local clients. The optional remote mount uses host-owned HTTPS and token verification.

Stdio uses the SDK serving lifecycle and supports the protocol eras selected there. HTTP creates fresh server instances through the SDK factory and supports the modern era; legacy HTTP requests are refused. Binding is restricted to 127.0.0.1 or ::1, with host/origin validation and the configured request path checked before serving. The returned serving handle exposes shutdown; an external caller owns when to close it.

A tool receives the SDK request AbortSignal. Passing that signal into a source is cooperative cancellation, not forced termination of arbitrary work. Tool code can have performed effects before throwing or before a connection closes. Transport shutdown does not turn an error into evidence of rollback.

The `/testing` helpers open disposable stdio/HTTP clients for tests. They are fixtures, not extra product endpoints. Tests cover transport refusal and session/request behavior. The current bin has no HTTP flag, port configuration or remote deployment path.
The host composes the relevant server-kit entry explicitly.

## Mount a modern remote endpoint

The host supplies the public HTTPS address, exact allowed Host and Origin
values, required scopes, and a verifier for the configured resource audience.
The kit starts no listener and trusts no forwarded headers. The host owns
HTTPS, request deadlines and rate limits, token acquisition, and shutdown.
It must stop routing new requests and dispose of its listener.

An unapproved Host or present Origin is refused before authorization. Metadata
discovery on its well-known path does not require a token. It advertises the
same scopes the bearer gate enforces. Every MCP request
must pass the host verifier and the SDK bearer gate before the SDK dispatches
it for the modern era. Absent Origin does not change that. The legacy HTTP
request is still refused. The SDK client test lists and calls a tool and reads
its application resource on a disposable listener. It does not render the
resource in a remote host.
