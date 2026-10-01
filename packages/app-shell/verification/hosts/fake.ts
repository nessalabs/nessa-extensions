/**
 * The fake host's page: the built fixture app in `mountFakeHostFrame`. The
 * test calls `start` with a scenario, then drives `window.host`.
 */
import type { CallToolResult, HostContext } from "../../src/index.ts"
import {
  HostRefusal,
  mountFakeHostFrame,
  type FakeHost,
  type FakeToolCall,
} from "../../src/fake-host/index.ts"

export interface Scenario {
  context?: HostContext
  tool?: FakeToolCall
  /** Each tool the app may call, and what it returns; any other is refused. */
  tools?: Record<string, CallToolResult>
}

declare global {
  interface Window {
    startFakeHost(scenario: Scenario): Promise<void>
    fakeHost: FakeHost
    iframe: HTMLIFrameElement
  }
}

window.startFakeHost = async (scenario) => {
  const html = await (await fetch("../app/index.html")).text()
  const container = document.getElementById("host")
  if (container === null) throw new Error("no #host")
  const tools = scenario.tools ?? {}
  const { host, iframe } = mountFakeHostFrame({
    container,
    html,
    ...(scenario.context === undefined ? {} : { context: scenario.context }),
    ...(scenario.tool === undefined ? {} : { tool: scenario.tool }),
    handlers: {
      callTool: ({ name }) => {
        if (!Object.hasOwn(tools, name)) throw new HostRefusal(`no tool ${name}`)
        return tools[name] as CallToolResult
      },
    },
  })
  window.fakeHost = host
  window.iframe = iframe
  await host.initialized
}
