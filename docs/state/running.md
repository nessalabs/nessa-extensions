---
id: "ext-running"
title: "Run the current entry"
kind: "guide"
status: "mixed"
summary: "Build the workspace before asking a host to start the experiments server. The executable reads its bundled HTML at startup and fails immediately when the app is missing. Its stdout belongs to MCP; startup and server errors go to stderr."
parent: "nessa-extensions"
sources: ["package.json", "extensions/experiments/package.json", "extensions/experiments/server/main.ts", "extensions/experiments/server/samples-source.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Run the current entry

Build the workspace before asking a host to start the experiments server. The executable reads its bundled HTML at startup and fails immediately when the app is missing. Its stdout belongs to MCP; startup and server errors go to stderr.

From a checkout with Node 24 or newer and pnpm 11.9.0, run `pnpm architecture` before installation, then `pnpm install --frozen-lockfile` and `pnpm build`. Configure an MCP host to start `node` with the absolute path to `extensions/experiments/dist/main.js`. Starting that program manually opens a stdio protocol server, not a terminal interface or website. No published package is established by these instructions.

The built entry supplies checkout, latency and scale samples dated from process startup. A sample records changed file names, not their contents, so opening one returns an unavailable reason. To use real data, an integrator must implement `ExperimentSource` and compose it into `experimentsExtension`; no UI setting changes the source. The server-kit HTTP function is a separate [loopback serving API](services/server-kit/transports.md), not an executable flag.

A capable host can call `show_experiment`, read its `ui://` resource and embed the card. A host without app rendering still receives standalone text. Host sandbox, user approval and remote execution belong to that host. See [negotiation](services/server-kit/negotiation.md) before treating a tool's advertised visibility as authority.
