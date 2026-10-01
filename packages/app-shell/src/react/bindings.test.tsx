// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { createBridge, type Bridge } from "../bridge/bridge.ts"
import { createFakeHost, type FakeHost } from "../fake-host/fake-host.ts"
import { memoryChannel } from "../protocol/memory-channel.ts"
import type { DesignTokens } from "../theming/design-tokens.ts"
import {
  BridgeProvider,
  HostThemeScope,
  useConnection,
  useDisplayMode,
  useHostContext,
  useHostTheme,
  useTeardown,
  useToolCall,
  useToolInput,
  useToolResult,
} from "./bindings.tsx"

afterEach(cleanup)

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })

async function connectedPair(
  options: Partial<Parameters<typeof createFakeHost>[0]> = {},
) {
  const channel = memoryChannel()
  const host = createFakeHost({ transport: channel.host, ...options })
  const bridge = createBridge({
    transport: channel.app,
    app: { name: "a", version: "1" },
    displayModes: ["inline", "fullscreen"],
  })
  return { host, bridge }
}

function Probe() {
  const connection = useConnection()
  const context = useHostContext()
  const call = useToolCall()
  const input = useToolInput()
  const result = useToolResult()
  const { mode, available } = useDisplayMode()
  return (
    <dl>
      <dt>status</dt>
      <dd data-testid="status">{connection.status}</dd>
      <dd data-testid="theme">{context.theme ?? "none"}</dd>
      <dd data-testid="phase">{call.phase}</dd>
      <dd data-testid="input">{JSON.stringify(input ?? null)}</dd>
      <dd data-testid="result">{JSON.stringify(result?.structuredContent ?? null)}</dd>
      <dd data-testid="mode">{`${mode ?? "none"} of ${(available ?? []).join(",")}`}</dd>
    </dl>
  )
}

const text = (id: string) => screen.getByTestId(id).textContent

function mount(bridge: Bridge, children = <Probe />) {
  return render(<BridgeProvider bridge={bridge}>{children}</BridgeProvider>)
}

describe("the hooks", () => {
  it("follow the connection, the context, and the tool call as the host moves them", async () => {
    const { host, bridge } = await connectedPair({
      context: { theme: "light", availableDisplayModes: ["inline", "fullscreen"] },
    })
    mount(bridge)
    expect(text("status")).toBe("idle")
    await act(() => bridge.connect())
    await host.initialized
    expect(text("status")).toBe("connected")
    expect(text("theme")).toBe("light")
    expect(text("phase")).toBe("awaiting-input")
    expect(text("mode")).toBe("inline of inline,fullscreen")

    host.sendToolInput({ city: "Oslo" })
    host.changeContext({ theme: "dark" })
    await settle()
    expect(text("phase")).toBe("running")
    expect(text("input")).toBe('{"city":"Oslo"}')
    expect(text("theme")).toBe("dark")

    host.sendToolResult({ content: [], structuredContent: { temperature: 3 } })
    await settle()
    expect(text("result")).toBe('{"temperature":3}')
  })

  it("useDisplayMode's request asks the host and the mode follows", async () => {
    const { host, bridge } = await connectedPair({
      context: { availableDisplayModes: ["inline", "fullscreen"] },
    })
    let request: ReturnType<typeof useDisplayMode>["request"] = async () => "inline"
    function Requester() {
      request = useDisplayMode().request
      return null
    }
    mount(
      bridge,
      <>
        <Probe />
        <Requester />
      </>,
    )
    await act(() => bridge.connect())
    await host.initialized
    await act(async () => {
      await expect(request("fullscreen")).resolves.toBe("fullscreen")
    })
    expect(text("mode")).toBe("fullscreen of inline,fullscreen")
  })

  it("useBridge outside a provider is a wiring mistake", () => {
    const quiet = console.error
    console.error = () => {}
    try {
      expect(() => render(<Probe />)).toThrow(
        "useBridge is used outside a BridgeProvider",
      )
    } finally {
      console.error = quiet
    }
  })
})

describe("useHostTheme", () => {
  const tokens: DesignTokens<"--surface"> = {
    themeAttribute: "data-mode",
    fromHost: { "--surface": "--color-background-primary" },
  }

  function Themed({ root }: { root: HTMLElement }) {
    useHostTheme(tokens, root)
    return null
  }

  let host: FakeHost
  it("applies the host's theme, follows a change, reverts what a change leaves out, and clears on unmount", async () => {
    const pair = await connectedPair({
      context: {
        theme: "light",
        styles: { variables: { "--color-background-primary": "#ffffff" } },
      },
    })
    host = pair.host
    const root = document.createElement("div")
    const view = mount(pair.bridge, <Themed root={root} />)
    await act(() => pair.bridge.connect())
    await host.initialized
    expect(root.style.getPropertyValue("--surface")).toBe("#ffffff")
    expect(root.getAttribute("data-mode")).toBe("light")

    host.changeContext({ theme: "dark" })
    await settle()
    expect(root.getAttribute("data-mode")).toBe("dark")
    expect(root.style.getPropertyValue("--surface")).toBe("#ffffff")

    host.changeContext({ styles: { variables: {} } })
    await settle()
    expect(root.style.getPropertyValue("--surface")).toBe("")

    host.changeContext({
      styles: { variables: { "--color-background-primary": "#000000" } },
    })
    await settle()
    expect(root.style.getPropertyValue("--surface")).toBe("#000000")

    view.unmount()
    expect(root.style.getPropertyValue("--surface")).toBe("")
    expect(root.hasAttribute("data-mode")).toBe(false)
  })

  it("does nothing while the root is null", async () => {
    const pair = await connectedPair({ context: { theme: "dark" } })
    function Unrooted() {
      useHostTheme(tokens, null)
      return null
    }
    mount(pair.bridge, <Unrooted />)
    await act(() => pair.bridge.connect())
    await pair.host.initialized
    expect(document.documentElement.hasAttribute("data-mode")).toBe(false)
  })
})

describe("HostThemeScope", () => {
  const tokens: DesignTokens<"--surface"> = {
    themeAttribute: "data-mode",
    fromHost: { "--surface": "--color-background-primary" },
  }

  it("carries the host's variables and theme on its own element, around its children", async () => {
    const pair = await connectedPair({
      context: {
        theme: "dark",
        styles: { variables: { "--color-background-primary": "#123456" } },
      },
    })
    const view = mount(
      pair.bridge,
      <HostThemeScope tokens={tokens} data-testid="scope" className="scope">
        <span>inside</span>
      </HostThemeScope>,
    )
    await act(() => pair.bridge.connect())
    await pair.host.initialized
    const scope = screen.getByTestId("scope")
    expect(scope.className).toBe("scope")
    expect(scope.textContent).toBe("inside")
    expect(scope.getAttribute("data-mode")).toBe("dark")
    expect(scope.style.getPropertyValue("--surface")).toBe("#123456")
    expect(document.documentElement.hasAttribute("data-mode")).toBe(false)
    view.unmount()
  })
})

describe("useTeardown", () => {
  it("runs the latest handler with the host's reason, and not after unmount", async () => {
    const pair = await connectedPair()
    const reasons: (string | undefined)[] = []
    function Saver({ tag }: { tag: string }) {
      useTeardown((reason) => {
        reasons.push(`${tag}: ${reason}`)
      })
      return null
    }
    const view = mount(pair.bridge, <Saver tag="first" />)
    view.rerender(
      <BridgeProvider bridge={pair.bridge}>
        <Saver tag="second" />
      </BridgeProvider>,
    )
    await act(() => pair.bridge.connect())
    await pair.host.initialized
    await act(async () => {
      await pair.host.teardown("closed")
    })
    expect(reasons).toEqual(["second: closed"])
  })

  it("is not run once its component has unmounted", async () => {
    const pair = await connectedPair()
    let ran = false
    function Saver() {
      useTeardown(() => {
        ran = true
      })
      return null
    }
    const view = mount(pair.bridge, <Saver />)
    await act(() => pair.bridge.connect())
    await pair.host.initialized
    view.unmount()
    await pair.host.teardown()
    expect(ran).toBe(false)
  })
})
