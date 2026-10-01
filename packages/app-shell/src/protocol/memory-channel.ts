/**
 * Two transports joined to each other in memory, for tests and for the fake
 * host outside a browser. Like `postMessage`, each message is delivered
 * later, not during `send`, as a structured clone, so neither side can rely
 * on sharing an object with the other or on an answer arriving before `send`
 * returns. Order is kept.
 */
import type { JsonRpcMessage } from "./json-rpc.ts"
import type { Transport } from "./transport.ts"

export interface MemoryChannel {
  /** The app's end. */
  app: Transport
  /** The host's end. */
  host: Transport
}

export function memoryChannel(): MemoryChannel {
  const receivers = {
    app: new Set<(data: unknown) => void>(),
    host: new Set<(data: unknown) => void>(),
  }
  const end = (own: "app" | "host", peer: "app" | "host"): Transport => ({
    send(message: JsonRpcMessage) {
      const copy = structuredClone(message)
      queueMicrotask(() => {
        for (const receive of [...receivers[peer]]) receive(copy)
      })
    },
    listen(receive) {
      receivers[own].add(receive)
      return () => receivers[own].delete(receive)
    },
  })
  return { app: end("app", "host"), host: end("host", "app") }
}
