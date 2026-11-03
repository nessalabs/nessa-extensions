---
id: "ext-build"
title: "Build and dependencies"
kind: "guide"
status: "implemented"
summary: "An extension builds from its own folder, declared workspace packages and npm dependencies. The checks enforce that dependency layout at several different stages. They do not sandbox arbitrary Node code with full filesystem access."
parent: "nessa-extensions"
sources: ["packages/app-shell/src/build/mcp-app.ts", "packages/app-shell/src/build/inline.ts", "scripts/architecture/layout.mjs", "scripts/boundary/typecheck.mjs", "scripts/boundary/build.mjs", "scripts/boundary/vitest.mjs"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Build within dependency boundaries

An extension builds from its own folder, declared workspace packages and npm dependencies. The checks enforce that dependency layout at several different stages. They do not sandbox arbitrary Node code with full filesystem access.

Run architecture before install to check the pinned pnpm layout, manifests and permitted dependency declarations. Typecheck resolves each unit's program and real paths, including JSON/declarations. Build copies one extension and its allowed packages into a temporary stage, checks loaded module paths and copies dist back only after success. Vitest applies its own module-graph guard, including imports TypeScript may not resolve. Arbitrary Node actions, certain external assets and the dev server remain review responsibilities.

The MCP App build plugin produces one HTML resource with inline script, styles and assets. It refuses a nonempty public directory, unresolved local references, extra chunks, unsafe closing tags and bytes that cannot be inlined as text. It does not inspect every arbitrary URL in every HTML element; runtime CSP and browser tests remain necessary. The experiments entry sets Zod jitless before schema construction to avoid CSP-blocked dynamic-function probes.

`packages/common` is currently an empty export placeholder, not a shared runtime service. The experiment app's kit-stand-in is a temporary pinned copy of nessa_ui e02b577, checked byte-for-byte, with generated token defaults. Its components serve this extension's UI; they do not make the current workspace a published design system. Existing boundary and stand-in tests own these contracts.
