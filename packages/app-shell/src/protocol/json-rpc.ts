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
  if (data.jsonrpc !== "2.0") return { kind: "invalid", reason: 'jsonrpc is not "2.0"' }
  const params = Object.hasOwn(data, "params") ? data.params : undefined
  if (Object.hasOwn(data, "method")) {
    if (typeof data.method !== "string") {
      return { kind: "invalid", reason: "method is not a string" }
    }
    if (!Object.hasOwn(data, "id")) {
      return { kind: "notification", method: data.method, params }
    }
    if (!isId(data.id)) return { kind: "invalid", reason: "id is not a string or number" }
    return { kind: "request", id: data.id, method: data.method, params }
  }
  if (!isId(data.id))
    return { kind: "invalid", reason: "a response's id is not a string or number" }
  const hasResult = Object.hasOwn(data, "result")
  const hasError = Object.hasOwn(data, "error")
  if (hasResult === hasError) {
    return {
      kind: "invalid",
      reason: "a response has neither or both of result and error",
    }
  }
  if (hasResult) return { kind: "result", id: data.id, result: data.result }
  const error = data.error
  if (
    !isRecord(error) ||
    typeof error.code !== "number" ||
    typeof error.message !== "string"
  ) {
    return {
      kind: "invalid",
      reason: "a response's error has no numeric code and message",
    }
  }
  const read: JsonRpcError = { code: error.code, message: error.message }
  if (Object.hasOwn(error, "data")) read.data = error.data
  return { kind: "error", id: data.id, error: read }
}
