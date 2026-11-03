---
id: "ext-development"
title: "Test with development hosts"
kind: "guide"
status: "fixture"
summary: "The fake host drives a real app with controlled protocol replies, including refusals, context changes and teardown. It is a development fixture, not the user's desktop host or an authentication service. Passing there establishes the tested messages and browser behavior only."
parent: "nessa-extensions"
sources: ["packages/app-shell/src/fake-host/fake-host.ts", "packages/app-shell/src/fake-host/frame.ts", "packages/app-shell/src/fake-host/csp.ts", "packages/app-shell/verification/playwright.config.ts", "extensions/experiments/verification/large.mjs"]
sourceRevision: "47cb6984bebc81e8930edfcafc35e7d5c214b7ec"
diagramLinks: {}
---

# Test with development hosts

The fake host drives a real app with controlled protocol replies, including refusals, context changes and teardown. It is a development fixture, not the user's desktop host or an authentication service. Passing there establishes the tested messages and browser behavior only.

A memory channel supports unit tests. `mountFakeHostFrame` uses a sandboxed iframe with allow-scripts and no allow-same-origin, plus a CSP inserted before page code. Resource domains shape that policy; the default blocks network connections. The explicit CSP builder and no-argument restrictive policy have their own exact defaults. This fixture does not recreate a web host's separate-origin sandbox proxy.

The fake host waits for initialized before its tool sequence, records messages/violations and lets test handlers refuse calls. The reference SDK's AppBridge is another tested peer. `pnpm --filter @nessalabs/app-shell verify` runs both host paths in Chromium and WebKit after its fixture build. See [current receipts](verification.md) for the executed result.

After `pnpm build`, `node extensions/experiments/verification/large.mjs` exercises the built experiment app in both engines with a real extension server and a large sample. `--transport-only` omits browser claims. Its output measures actual double-encoded replies and visible virtualized rows. The real Nessa gateway capture is separate and requires a compatible host build; historical failure/pass records remain historical, not a current all-host acceptance claim.
