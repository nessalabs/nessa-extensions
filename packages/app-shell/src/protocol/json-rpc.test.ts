import { describe, expect, it } from "vitest"

import { readEnvelope } from "./json-rpc.ts"

describe("readEnvelope", () => {
  it("reads a request, a notification, a result, and an error", () => {
    expect(readEnvelope({ jsonrpc: "2.0", id: 1, method: "ping", params: {} })).toEqual({
      kind: "request",
      id: 1,
      method: "ping",
      params: {},
    })
    expect(
      readEnvelope({ jsonrpc: "2.0", method: "ui/notifications/initialized" }),
    ).toEqual({
      kind: "notification",
      method: "ui/notifications/initialized",
      params: undefined,
    })
    expect(readEnvelope({ jsonrpc: "2.0", id: "a", result: null })).toEqual({
      kind: "result",
      id: "a",
      result: null,
    })
    expect(
      readEnvelope({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32000, message: "no", data: [1] },
      }),
    ).toEqual({ kind: "error", id: 2, error: { code: -32000, message: "no", data: [1] } })
  })

  const invalid: [string, unknown, string][] = [
    ["not an object", "hello", "not an object"],
    ["an array", [], "not an object"],
    ["null", null, "not an object"],
    ["another version", { jsonrpc: "1.0", id: 1, result: {} }, 'jsonrpc is not "2.0"'],
    [
      "a method that is not a string",
      { jsonrpc: "2.0", method: 3 },
      "method is not a string",
    ],
    [
      "a request id that is an object",
      { jsonrpc: "2.0", id: {}, method: "x" },
      "id is not a string or number",
    ],
    [
      "a request id that is not finite",
      { jsonrpc: "2.0", id: Number.NaN, method: "x" },
      "id is not a string or number",
    ],
    [
      "a response without an id",
      { jsonrpc: "2.0", result: {} },
      "a response's id is not a string or number",
    ],
    [
      "a response with both result and error",
      { jsonrpc: "2.0", id: 1, result: {}, error: { code: 1, message: "x" } },
      "a response has neither or both of result and error",
    ],
    [
      "a response with neither",
      { jsonrpc: "2.0", id: 1 },
      "a response has neither or both of result and error",
    ],
    [
      "an error without a code",
      { jsonrpc: "2.0", id: 1, error: { message: "x" } },
      "a response's error has no numeric code and message",
    ],
  ]
  for (const [name, data, reason] of invalid) {
    it(`refuses ${name}`, () =>
      expect(readEnvelope(data)).toEqual({ kind: "invalid", reason }))
  }

  it("reads only fields the message holds itself, not inherited ones", () => {
    const inherited = Object.create({ method: "ping", id: 1 }) as object
    Object.assign(inherited, { jsonrpc: "2.0" })
    expect(readEnvelope(inherited).kind).toBe("invalid")
    const version = Object.create({ jsonrpc: "2.0" }) as object
    Object.assign(version, { id: 1, result: {} })
    expect(readEnvelope(version)).toEqual({
      kind: "invalid",
      reason: 'jsonrpc is not "2.0"',
    })
  })
})
