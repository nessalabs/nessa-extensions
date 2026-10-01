/**
 * JSON-RPC 2.0, the envelope every MCP Apps message travels in, and the one
 * place a message from the other side is first read. `readEnvelope` takes
 * whatever `postMessage` delivered and says which of the four kinds it is,
 * or that it is none of them; what a method's params mean is `narrow.ts`'s.
 */
import { isRecord } from "./narrow.ts"

export type RequestId = string | number

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: RequestId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: RequestId; result: unknown }
  | { jsonrpc: "2.0"; id: RequestId; error: JsonRpcError }

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

/** The error codes this package sends or reads by meaning. */
export const errorCodes = {
  /** The method is not one the receiver answers. */
  methodNotFound: -32601,
  /** The params are not what the method takes. */
  invalidParams: -32602,
  /** MCP Apps' implementation-defined error: refused, denied, failed. */
  refused: -32000,
} as const

/** A message read off the wire, by kind. */
export type Envelope =
  | { kind: "request"; id: RequestId; method: string; params: unknown }
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "result"; id: RequestId; result: unknown }
  | { kind: "error"; id: RequestId; error: JsonRpcError }
  | { kind: "invalid"; reason: string }

const isId = (value: unknown): value is RequestId =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value))

/** Which kind of JSON-RPC message `data` is, or why it is none. */
export function readEnvelope(data: unknown): Envelope {
  if (!isRecord(data)) return { kind: "invalid", reason: "not an object" }
  // Only what the message holds itself: never a field it inherits.
  const own = (record: Record<string, unknown>, key: string) =>
    Object.hasOwn(record, key) ? record[key] : undefined
  if (own(data, "jsonrpc") !== "2.0") {
    return { kind: "invalid", reason: 'jsonrpc is not "2.0"' }
  }
  const params = own(data, "params")
  const id = own(data, "id")
  if (Object.hasOwn(data, "method")) {
    const method = own(data, "method")
    if (typeof method !== "string") {
      return { kind: "invalid", reason: "method is not a string" }
    }
    if (!Object.hasOwn(data, "id")) return { kind: "notification", method, params }
    if (!isId(id)) return { kind: "invalid", reason: "id is not a string or number" }
    return { kind: "request", id, method, params }
  }
  if (!isId(id)) {
    return { kind: "invalid", reason: "a response's id is not a string or number" }
  }
  const hasResult = Object.hasOwn(data, "result")
  if (hasResult === Object.hasOwn(data, "error")) {
    return {
      kind: "invalid",
      reason: "a response has neither or both of result and error",
    }
  }
  if (hasResult) return { kind: "result", id, result: own(data, "result") }
  const error = own(data, "error")
  const code = isRecord(error) ? own(error, "code") : undefined
  const message = isRecord(error) ? own(error, "message") : undefined
  if (!isRecord(error) || typeof code !== "number" || typeof message !== "string") {
    return {
      kind: "invalid",
      reason: "a response's error has no numeric code and message",
    }
  }
  const read: JsonRpcError = { code, message }
  if (Object.hasOwn(error, "data")) read.data = error.data
  return { kind: "error", id, error: read }
}
