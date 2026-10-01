/**
 * Test support: one end of a `memoryChannel` as the reference SDK's MCP
 * `Transport`, so the standard's own `App` and `AppBridge`
 * (`@modelcontextprotocol/ext-apps`) talk to this package's fake host and
 * bridge in the conformance tests.
 */
import type { Transport as ReferenceTransport } from "@modelcontextprotocol/client"

import type { JsonRpcMessage } from "../protocol/json-rpc.ts"
import type { Transport } from "../protocol/transport.ts"

export function referenceTransport(end: Transport): ReferenceTransport {
  let stop: (() => void) | null = null
  const transport: ReferenceTransport = {
    async start() {
      stop = end.listen((data) => {
        // The reference reads what arrives as it reads its own wire.
        transport.onmessage?.(
          data as Parameters<NonNullable<ReferenceTransport["onmessage"]>>[0],
        )
      })
    },
    async send(message) {
      end.send(message as JsonRpcMessage)
    },
    async close() {
      stop?.()
      stop = null
      transport.onclose?.()
    },
  }
  return transport
}
