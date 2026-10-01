import { describe, expect, it } from "vitest"

import type { JsonRpcMessage } from "./json-rpc.ts"
import { windowPairTransport, type MessageSource } from "./transport.ts"

/** A window that hands each dispatched event to its message listeners. */
function fakeWindow() {
  const listeners = new Set<(event: MessageEvent) => void>()
  const own: MessageSource = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  }
  const dispatch = (source: unknown, data: unknown) => {
    for (const listener of listeners) listener({ source, data } as MessageEvent)
  }
  return { own, dispatch, listening: () => listeners.size }
}

describe("windowPairTransport", () => {
  it("receives only what its peer window sent, and stops when told", () => {
    const peer = { postMessage: () => {} }
    const window = fakeWindow()
    const received: unknown[] = []
    const stop = windowPairTransport(window.own, () => peer).listen((data) =>
      received.push(data),
    )
    window.dispatch(peer, "from the peer")
    window.dispatch({ postMessage: () => {} }, "from another window")
    window.dispatch(null, "from nowhere")
    expect(received).toEqual(["from the peer"])
    stop()
    expect(window.listening()).toBe(0)
  })

  it("posts to its peer with any target origin, and throws when there is none", () => {
    const sent: [unknown, string][] = []
    const message: JsonRpcMessage = { jsonrpc: "2.0", method: "ping" }
    const window = fakeWindow()
    windowPairTransport(window.own, () => ({
      postMessage: (data: unknown, origin: string) => sent.push([data, origin]),
    })).send(message)
    expect(sent).toEqual([[message, "*"]])
    expect(() => windowPairTransport(window.own, () => null).send(message)).toThrow(
      "there is no host window to send to",
    )
  })
})
