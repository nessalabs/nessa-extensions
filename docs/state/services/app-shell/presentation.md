---
id: "ext-presentation"
title: "Follow size and host theme"
kind: "contract"
status: "implemented"
summary: "An embedded app follows the context its host supplies and keeps its own stylesheet defaults for missing values. The host may change theme, locale, display mode or dimensions while the app is open. The app does not assume optional host fields exist."
parent: "ext-app-shell"
sources: ["packages/app-shell/src/react/bindings.tsx", "packages/app-shell/src/react/mount.tsx", "packages/app-shell/src/bridge/auto-resize.ts", "packages/app-shell/src/theming/host-theme.ts", "packages/app-shell/src/theming/nessa-ui-tokens.ts"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Follow size and host theme

An embedded app follows the context its host supplies and keeps its own stylesheet defaults for missing values. The host may change theme, locale, display mode or dimensions while the app is open. The app does not assume optional host fields exist.

`HostThemeScope` puts host variables and the design-system theme attribute on the same element. Each application removes properties the previous context owned, then installs accepted replacements; omitted, unsafe or browser-invalid values reveal CSS defaults. It does not restore another owner's earlier inline values. The root's owned custom properties and color-scheme must therefore belong to this applier alone. Clearing or changing the root/token mapping removes the old applier's properties.

Theme values pass a restricted character/function allow-list and use individual `style.setProperty` calls. Fetching functions such as `url()` are refused. This is a theme-value boundary, not a claim to sanitize arbitrary HTML or CSS. The Nessa token mapping is pinned to the design-system source identified in its owning module.

Automatic resizing measures the document (or supplied element), rounds dimensions up and reports while the connection is open. Duplicate sizes are suppressed by the bridge. Closing/torn-down state stops observation; an already-connected teardown remains open while its handlers finish. A failed send is logged and leaves the host's prior size. A host ultimately decides how to size its iframe.

`useDisplayMode` reports the actual host context and exposes a request function. `useTeardown` registers the latest mounted handler. Neither a provider nor a theme scope independently opens a bridge connection.
