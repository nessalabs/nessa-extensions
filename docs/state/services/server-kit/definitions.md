---
id: "ext-definitions"
title: "Validate definitions and replies"
kind: "contract"
status: "implemented"
summary: "A server definition must name valid, unique tools and views before serving begins. A tool referring to an undeclared view is refused at construction, rather than becoming a broken app link in a later response."
parent: "ext-server-kit"
sources: ["packages/server-kit/src/definition.ts", "packages/server-kit/src/definition.test.ts", "packages/server-kit/src/server.ts", "packages/server-kit/src/server.test.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Validate definitions and replies

A server definition must name valid, unique tools and views before serving begins. A tool referring to an undeclared view is refused at construction, rather than becoming a broken app link in a later response.

`defineTool` retains a frozen copy and `defineExtension` parses and freezes view metadata with strict reference-SDK schemas. It checks tool-name syntax, unique `ui://` view URIs, nonempty caller lists, declared references and JSON-Schema conversion. App-only tools require a view. Original input schema objects are not deeply copied; extension authors must preserve their contract. A checked registry identity prevents forged or spread copies from bypassing construction.

A tool declares read-only, additive or destructive effects, which map to MCP annotations. Every outcome must contain nonempty standalone text and may contain one JSON object as data. Parsing input, running the tool and reading its answer happen inside the failure guard. Invalid input, thrown work or invalid output becomes a tool error (`isError`), with text naming the tool. An error result does not roll back effects the tool already performed.

Reply data is copied from plain own data properties. Getters, symbol keys, sparse arrays, extra array properties, nonfinite numbers, class instances and excessive depth are refused. The accepted copy is what travels, so later mutation of an original answer cannot change it. `resources/read` separately checks that the registered view producer returned HTML text; an unknown URI or failed producer is a protocol error.
