---
id: "nessa-extensions"
title: "Explore Nessa extensions"
kind: "system"
status: "mixed"
summary: "This workspace builds MCP servers with small embedded apps. Today its one extension displays experiment results: it does not launch experiments or decide which changes win. Extension authors use the shared browser bridge and server kit; a host supplies the conversation, permissions and sandbox."
parent: null
sources: ["README.md", "packages/app-shell/src/index.ts", "packages/server-kit/src/index.ts", "extensions/experiments/server/main.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {"Bridge": "ext-app-shell", "App": "ext-experiments", "Server": "ext-server-kit", "Data": "ext-data", "Build": "ext-build"}
---

# Explore Nessa extensions

This workspace builds MCP servers with small embedded apps. Today its one extension displays experiment results: it does not launch experiments or decide which changes win. Extension authors use the shared browser bridge and server kit; a host supplies the conversation, permissions and sandbox.

Start with [running the current extension](running.md), [reading an experiment](services/experiments/README.md), [connecting an app to its host](services/app-shell/README.md), or [defining and serving tools](services/server-kit/README.md). The [feature inventory](inventory.md) maps every source responsibility, including development helpers. [Evidence and limits](verification.md) separates executed tests from models and historical host captures.

```mermaid
flowchart LR
  Host[External MCP Apps host] --> Bridge[Browser app shell]
  Bridge --> App[Experiment views]
  Host --> Server[Server kit]
  Server --> Data[Experiment source and tools]
  Data --> App
  Build[Build and boundary checks] --> App
```

The current executable uses the sample source over stdio. Server-kit also implements a loopback HTTP API, but the executable does not select it. Packages are private at this checkpoint; README installation examples describe the intended publishing surface. The app and server are implemented, while a real experiment harness and production publication remain separate work.
