# @nessalabs/app-shell

What an extension's MCP App is built on, in the browser. The app is HTML that
a host renders in a sandboxed iframe; this package is how it talks to that host
([MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
SEP-1865, protocol `2026-01-26`), how it takes the host's theme, how it is
tested without a host, and how it is built into the one HTML file the host is
given. Built in [#2](https://github.com/nessalabs/nessa-extensions/issues/2).

It is private: an extension's build bundles it into the app (see the
[repository's decision record](../../docs/adr/todo/1-extensions-repo.md)).

```tsx
// An extension's app/main.tsx
import { nessaUiTokens } from "@nessalabs/app-shell"
import { HostThemeScope, mountApp, useToolResult } from "@nessalabs/app-shell/react"

function Weather() {
  const result = useToolResult()
  return <p>{result === undefined ? "Loading…" : String(result.structuredContent?.temperature)}</p>
}

mountApp(
  document.getElementById("root")!,
  <HostThemeScope tokens={nessaUiTokens}>
    <Weather />
  </HostThemeScope>,
  { app: { name: "weather", version: "1.0.0" }, displayModes: ["inline", "fullscreen"] },
)
```

```ts
// An extension's vite.config.ts
import { mcpApp } from "@nessalabs/app-shell/build"
export default defineConfig({ plugins: [react(), mcpApp()] })
```

## Entry points and modules

| Entry | What it holds |
| --- | --- |
| `@nessalabs/app-shell` | The bridge client, its failures, the wire types, the transport, theming |
| `@nessalabs/app-shell/react` | React bindings and `mountApp` |
| `@nessalabs/app-shell/fake-host` | The fake host, in memory and in a browser frame |
| `@nessalabs/app-shell/build` | The Vite plugin that builds an app into one HTML file (Node) |

```
src/
  protocol/     the standard's messages as this package reads and writes them
    messages.ts     the wire types, and the closed sets (display modes, style variables, …)
    json-rpc.ts     the envelope: reads what postMessage delivered into a request, notification, result or error
    narrow.ts       reads untrusted params into the wire types: required fields refuse, optional ones drop
    transport.ts    the seam: Transport, and the window's (windowTransport) and a window pair's
    memory-channel.ts  two transports joined in memory, for tests
  bridge/       the app's side of the bridge
    bridge.ts       createBridge: the connection, the app's calls, the state an app renders
    tool-call.ts    the tool call's phases (pure)
    failures.ts     BridgeFailure (the app's calls) and HostViolation (the host breaking the standard)
    auto-resize.ts  ui/notifications/size-changed as the document's size changes
  theming/      the host's theme through a design system's tokens
    design-tokens.ts   the token interface
    nessa-ui-tokens.ts nessa_ui's map: the only place its token names are written
    host-theme.ts      the safe applier
  react/        bindings.tsx (provider, hooks, HostThemeScope) and mount.tsx (mountApp)
  fake-host/    fake-host.ts (the protocol), frame.ts (a sandboxed iframe), csp.ts (the standard's policy)
  build/        inline.ts (pure) and mcp-app.ts (the Vite plugin)
  conformance/  lifecycle tests against the reference SDK, and their transport adapter
fixture/        an app built on the shell, used by the browser verification
verification/   the browser verification: Playwright in Chromium and WebKit, two hosts
```

```
  app code ──calls──▶ Bridge ──send──▶ Transport ──postMessage──▶ host
  app code ◀─state─── Bridge ◀─listen─ Transport ◀──────────────── host
```

Arrows are the direction a message or state travels. The bridge owns the
connection and the state; the transport only carries messages; the host
decides what it allows.

## The bridge

`createBridge({ transport, app, displayModes })` speaks the standard's
messages:

| Direction | Messages |
| --- | --- |
| app → host, requests | `ui/initialize`, `tools/call`, `resources/read`, `ui/message`, `ui/update-model-context`, `ui/request-display-mode`, `ui/open-link` |
| app → host, notifications | `ui/notifications/initialized`, `ui/notifications/size-changed`, `notifications/message` |
| host → app, notifications | `ui/notifications/tool-input-partial`, `tool-input`, `tool-result`, `tool-cancelled`, `host-context-changed` |
| host → app, requests | `ui/resource-teardown`, `ping`; any other is answered "method not found" |

A call the host refuses rejects with a `BridgeError` whose `failure` is typed:
`host-error` (a JSON-RPC error), `refused` (an `isError: true` answer), `not-sent`,
`malformed-result`, `not-connected`, `torn-down`, `closed`, `aborted`,
`protocol-version`, `display-mode-undeclared`, `display-mode-unavailable`. The
app shows it; it never assumes success. The bridge refuses a call itself only
where the standard has the app check first: a display mode the app did not
declare, or one the host's context does not offer. Every other decision is the
host's.

A host breaking the standard — a malformed message, a notification before
`initialized`, a tool notification out of order — is reported to
`onViolation` (by default `console.warn`) and survived.

No `openai/*` field is required. The optional ones are typed:
`hostContext["openai/modelContext"]`, and `_meta["openai/message"]` on
`ui/message`, sent with `sendMessage(content, { openai })`.

### The connection

Each row has a test named for it in `src/bridge/bridge.test.ts`.

The state is the one owner of how connecting ended: `connect()`'s promise is
settled from it after each change (connected resolves; failed, closed and
torn-down reject), and by nothing else, so what the caller is told and what
`useConnection` shows never disagree.

| State | Event | Next | What is sent and settled |
| --- | --- | --- | --- |
| idle | `connect()` | connecting | `ui/initialize` with the app, its display modes, and `2026-01-26` |
| connecting | the result, in this version | connected | `ui/notifications/initialized`, **before** subscribers hear "connected", so nothing the app sends on hearing it precedes it |
| connecting | an error | failed (`host-error`) | `connect` rejects |
| connecting | a malformed result | failed (`malformed-result`) | `connect` rejects |
| connecting | another protocol version | failed (`protocol-version`) | `connect` rejects; `initialized` is never sent |
| connecting | the caller's signal aborts | failed (`aborted`) | a late answer is ignored, not reported |
| connecting | `close()` — before or after the answer arrives, or from a subscriber hearing "connecting" | closed | `connect` rejects `closed`; `initialized` is never sent |
| idle, connecting | `ui/resource-teardown` | tearing-down, never opened | the teardown handlers run; no call is carried; a result arriving meanwhile, or an abort, does not change it |
| tearing-down, never opened | the handlers settle | torn-down | `connect` rejects `torn-down`, together with the state; the host is answered |
| any | `connect()` again | — | the same promise; after failed or closed, `not-connected` |
| idle, connecting | a call or notification | — | refused `not-connected`; nothing sent |
| idle, connecting | a host notification | — | reported `before-initialized`, ignored |
| connected | `ui/resource-teardown` | tearing-down | the teardown handlers run; the app's calls are still carried, so it can save |
| tearing-down | the handlers settle | torn-down | the host is answered (`Teardown error` if a handler failed); unanswered calls reject `torn-down` |
| tearing-down, torn-down | `ui/resource-teardown` again | — | the handlers do not run again; each request is answered |
| any but closed | `close()` | closed | stops listening; unanswered calls reject `closed` |
| failed | `ui/resource-teardown` | failed | the failure is kept; the host is answered |
| any | a message cannot be sent (no host window, not cloneable) | — | the call rejects `not-sent`; nothing is left pending; `connect` fails `not-sent` |
| any | a subscriber throws | — | logged; the other subscribers and the bridge go on |
| any | a transition | — | subscribers are told after it completes, once per turn (a microtask), so one that calls back in — `close()`, `connect()` again — finds no transition half done. `connect` has resolved by the time a subscriber hears "connected"; closing then is the "any but closed, `close()`" row |
| any | a call aborted by its signal | — | it rejects `aborted`; the host is not told (the standard gives an app no cancellation), so a forwarded `tools/call` may still run |
| any | an answer to an id not pending | — | silent if the call was settled here (aborted, closed, torn down); otherwise reported `unknown-response` |

The host context is merged by field: each `host-context-changed` field
replaces the one held and the rest stay (SEP-1865: the view "SHOULD merge
received fields with its current context state"). So a theme-only change keeps
the styles, and a change carrying `styles` replaces them whole: a variable it
leaves out returns to the app's default.

### The tool call

`nextToolCall` in `src/bridge/tool-call.ts`; each row has a test in
`tool-call.test.ts`. "Reported" means a `tool-order` violation.

| Phase | partial input | input | result | cancelled |
| --- | --- | --- | --- | --- |
| awaiting-input | streaming-input | running | complete, without input; reported | cancelled |
| streaming-input | streaming-input | running | complete, without input; reported | cancelled |
| running | unchanged; reported | unchanged; reported | complete | cancelled |
| complete | streaming-input (the next call) | running (the next call) | unchanged; reported | unchanged; reported |
| cancelled | streaming-input (the next call) | running (the next call) | unchanged; reported | unchanged; reported |

The notifications carry no call identity, so "the call" is the current one,
and a new input after it settles begins the next, as the standard's
interactive phase allows. A result before any input is still the result, so it
is kept; a second settlement carries no meaning and is ignored.

## Theming

A host passes MCP Apps' style variables and a light or dark theme. A design
system has tokens of its own. `DesignTokens` maps each token to the host
variable that supplies it, and names the attribute that tells the design
system the theme. `nessaUiTokens` is nessa_ui's.

`HostThemeScope` (or `useHostTheme` on an element of the app's choosing) sets,
on that one element, each host variable as itself, each token from its host
variable, `color-scheme`, and the theme attribute. They go on the same element
because a design system declares its dark values on the element carrying the
attribute, and descendants read the nearest declaration.

Host values are untrusted:

- Each is set with `style.setProperty`, never written into CSS text.
- Names come only from the standard's closed set.
- A value is set only when it is built from what a theme value needs: letters, digits, spaces, quotes, `# % . , ( ) + - * /`, and calls to colour, arithmetic and `var` functions (`isSafeValue`). No `;`, braces, escapes, `url(`, `image-set(`.
- A value the browser does not take is left unset.

Whatever the host does not supply keeps the app's stylesheet default.
`styles.css.fonts` is not applied: it is CSS text, and the app uses its own or
the system's fonts.

**Until `@nessalabs/ui` is on npm**
([nessalabs/nessa_ui#115](https://github.com/nessalabs/nessa_ui/issues/115)),
nessa_ui's token names are typed by hand in `nessa-ui-tokens.ts`, read from
its `theme.css` at the commit named there, and `fixture/fixture.css` stands
in for its stylesheet. When it publishes, `NessaUiToken` becomes the type the
package exports, and the fixture uses the package's CSS.

## The fake host

`createFakeHost({ transport, context, capabilities, tool, handlers })` plays
the standard's sequence:

1. It answers `ui/initialize`.
2. After `initialized`, it plays the tool call: partial inputs, the input, then the result or the cancellation.
3. It answers the app's requests through `handlers`, any of which may throw a `HostRefusal`.
4. `teardown()`, `changeContext()`, `sendToolResult()` and the rest let a test drive it.

It records:

- every message, both ways (`log`);
- what the app sent: `messages`, `modelContext`, `links`, `sizes`, `logs`;
- every way the app broke the standard (`violations`).

It holds itself to the standard as a host. It sends nothing before
`initialized`, and throws `FakeHostMisuse` if a test tries.

`mountFakeHostFrame({ container, html, csp, ... })` puts it in a browser: the
app's HTML in an `<iframe sandbox="allow-scripts">`, an opaque origin, under
the policy the standard gives a resource (`appCsp`: the restrictive default
when nothing is declared). A Storybook story renders into the element it is
given the same way.

## Building an app

`mcpApp()` sets the Vite build to produce one script and one stylesheet, with
every asset as a `data:` URL, then writes them into the HTML exactly as they
are (`inlineIntoHtml`). The build fails if anything is left that the HTML
would have to fetch, since a host's default policy refuses it, a file in the
public directory included; and if a script or stylesheet would not end where it
is written — it holds its own closing tag, or `<!--` with `<script` — since no
rewrite of code reads the same everywhere. Bundlers already write `<\/script`
in strings.
The fixture's build is that: `verification/dist/app/index.html`, one file,
which runs under the restrictive policy.

## Tests and verification

- **Unit tests** (`pnpm test`): one per message and per table row, with the
  bridge against a host scripted message by message.
- **Conformance** (`src/conformance/lifecycle.test.ts`): the standard's
  lifecycle in order. Three pairings, so neither half only agrees with itself:
  - this bridge with this fake host;
  - this bridge with the reference SDK's host (`AppBridge`);
  - the reference SDK's app (`App`) with this fake host.

  Every message the bridge sends must also pass the reference SDK's schema for
  its method. `src/protocol/wire.test.ts` checks the wire types against the
  reference SDK's in the compiler. The reference SDK
  (`@modelcontextprotocol/ext-apps`) is a dev dependency, used by tests only.
- **Browser verification** (`pnpm verify` in this package; not a CI gate, per
  the standards' browser verification): the fixture app built with `mcpApp`,
  in Chromium and WebKit, in the fake host and in the reference SDK's
  `AppBridge`. It prints one JSON line of measurements per contract:

  | Contract | Measured |
  | --- | --- |
  | renders | the tool call is shown; console errors and host violations are 0 under the restrictive policy; time to connected |
  | theme-change | the card's computed background follows a changed `--color-background-primary`; a variable left out returns to the default |
  | theme-mode | `light-dark()` resolves by the host's theme, and a theme change switches it and the design system's dark defaults |
  | unsafe value | a value with `;` and `url(` leaves the default |
  | size | the iframe's height equals the height the app last reported |
  | refusal | a refused call, an unavailable display mode, and a granted call are each shown as the host answered |
  | teardown | the app shows the host's reason and is torn down |
  | reference host | the same app connects to `AppBridge`, takes its theme, follows a change, and calls through |

  Portability is tested in two hosts: the fake host and the reference SDK's.
  Nessa is the second required host once it hosts MCP Apps
  ([nessalabs/nessa-agent#349](https://github.com/nessalabs/nessa-agent/issues/349)).
