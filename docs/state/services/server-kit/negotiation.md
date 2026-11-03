---
id: "ext-negotiation"
title: "Understand tool visibility"
kind: "contract"
status: "implemented"
summary: "A client that declares the MCP Apps HTML MIME type receives UI metadata and the app-facing tools. This declaration describes rendering capability; it is not proof of the caller's identity or permission to perform an operation."
parent: "ext-server-kit"
sources: ["packages/server-kit/src/negotiation.ts", "packages/server-kit/src/server.ts", "packages/server-kit/src/server.test.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Understand tool visibility

A client that declares the MCP Apps HTML MIME type receives UI metadata and the app-facing tools. This declaration describes rendering capability; it is not proof of the caller's identity or permission to perform an operation.

For the modern protocol era, the server reads capabilities from the current request envelope. For legacy sessions it reads the initialized connection. A modern request without capability does not inherit a previous request's app declaration.

| Request | Client with app rendering | Client without it |
| --- | --- | --- |
| tools/list | All registered tools, including UI metadata where defined | Only tools whose callers include model, without UI metadata |
| tools/call | Registered tool accepted for normal input validation | App-only tool refused as unknown |
| resources/list | Registered app views | Empty list |
| resources/read | Known view readable | Known view still readable |
| resources/templates/list | Empty | Empty |

A known resource remains readable even when it was not listed. Do not treat a hidden resource or app-only tool advertisement as an access-control system. The extension and host must supply any required authentication and authorization. The server's capabilities are fixed before client initialization, so it does not claim a server-side MCP Apps client extension capability. Tests exercise modern request isolation and legacy negotiation directly.
