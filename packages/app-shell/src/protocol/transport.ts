/**
 * How a JSON-RPC message reaches the other side: the seam between the bridge
 * and `postMessage` (gate 9). The bridge and the fake host take a
 * `Transport`; composition gives them a window's (`windowTransport`, the
 * app in its iframe; `frameTransport`, a host and the iframe it made) and
 * tests give them one end of a `memoryChannel`.
 */
import type { JsonRpcMessage } from "./json-rpc.ts"

export interface Transport {
  /**
   * Sends one message to the other side. Throws if it cannot: there is no
   * other side, or the message cannot be cloned across.
   */
  send(message: JsonRpcMessage): void
  /**
   * Hands every message from the other side to `receive`, unread: the
   * receiver reads it (`readEnvelope`). Returns what stops listening.
   */
  listen(receive: (data: unknown) => void): () => void
}

/** The part of a window a transport uses: one that sends, one that receives. */
export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void
}
export interface MessageSource {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

/**
 * The transport between `own`, a window, and `peer`, the window on the other
 * side: messages go to `peer`, and only messages whose `source` is `peer` are
 * received.
 *
 * The target origin is `*`. The app does not know its host's origin — on a
 * web host it is a sandbox proxy's, on another origin — and the standard's own
 * transport posts to `*` too. What is sent is only ever what the app chose to
 * tell its host; what is received is checked by its source window, not its
 * origin, which a sandboxed iframe's opaque origin would not tell apart.
 */
export function windowPairTransport(
  own: MessageSource,
  peer: () => MessageTarget | null,
): Transport {
  return {
    send(message) {
      const target = peer()
      if (target === null) throw new Error("there is no host window to send to")
      target.postMessage(message, "*")
    },
    listen(receive) {
      const listener = (event: MessageEvent) => {
        const from = peer()
        if (from !== null && event.source === from) receive(event.data)
      }
      own.addEventListener("message", listener)
      return () => own.removeEventListener("message", listener)
    },
  }
}

/** The app's transport: to and from the window that holds its iframe. */
export function windowTransport(own: Window = window): Transport {
  return windowPairTransport(own, () => (own.parent === own ? null : own.parent))
}
