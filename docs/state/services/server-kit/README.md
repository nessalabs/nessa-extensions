---
id: "ext-server-kit"
title: "Define and serve an extension"
kind: "service"
status: "implemented"
summary: "The server kit turns checked tool and view definitions into an MCP server. Extension code owns each tool's work; the kit owns definition checks, request parsing, reply copying, negotiation and serving adapters."
parent: "nessa-extensions"
sources: ["packages/server-kit/src/index.ts", "packages/server-kit/src/definition.ts", "packages/server-kit/src/server.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Define and serve an extension

The server kit turns checked tool and view definitions into an MCP server. Extension code owns each tool's work; the kit owns definition checks, request parsing, reply copying, negotiation and serving adapters.

Read [definitions and outcomes](definitions.md) before adding a tool, [per-request negotiation](negotiation.md) before interpreting visibility, and [transports](transports.md) before choosing a serving entry. The [experiments tools](../experiments/data.md) are the current consumer, using stdio with an injected source.

A definition is checked once, copied and retained in a private registry. A spread or hand-built object is not accepted as a checked definition. The kit advertises effects and intended callers; those annotations help a host decide how to present a request but do not implement authentication or user approval.
