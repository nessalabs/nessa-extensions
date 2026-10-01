/**
 * What can go wrong for the app on the bridge, as types (gate 1).
 *
 * - A `BridgeFailure` is why one of the app's own calls did not succeed. It
 *   reaches the caller as a rejected promise holding a `BridgeError`, whose
 *   `failure` is the typed case to branch on. A host that refuses is one of
 *   these, and the app shows it (gate 7); it never assumes success.
 * - A `HostViolation` is the host breaking the standard in a way the app
 *   survives: a malformed message, a notification out of order. The bridge
 *   reports it and carries on.
 */
import type { DisplayMode } from "../protocol/messages.ts"
import type { RequestId } from "../protocol/json-rpc.ts"

/** Where the bridge's connection stands, as a failure can name it. */
export type ConnectionStatus =
  "idle" | "connecting" | "connected" | "tearing-down" | "torn-down" | "failed" | "closed"

export type BridgeFailure =
  /** The host answered with a JSON-RPC error. */
  | { kind: "host-error"; method: string; code: number; message: string; data?: unknown }
  /** The host answered, and the answer says it refused (`isError: true`). */
  | { kind: "refused"; method: string }
  /** The host answered with something that is not the method's result. */
  | { kind: "malformed-result"; method: string; reason: string }
  /**
   * The message could not be sent: there is no host window (the app is not in
   * an iframe), or what the app passed cannot cross `postMessage`.
   */
  | { kind: "not-sent"; method: string; reason: string }
  /** The call was made when the connection could not carry it. */
  | { kind: "not-connected"; method: string; status: ConnectionStatus }
  /** The host tore the app down before it answered. */
  | { kind: "torn-down"; method: string }
  /** The app closed the bridge before the host answered. */
  | { kind: "closed"; method: string }
  /** The caller's signal aborted the call. */
  | { kind: "aborted"; method: string }
  /** The host answered `ui/initialize` with a protocol version this package does not speak. */
  | { kind: "protocol-version"; offered: string; spoken: string }
  /** The app asked for a display mode it did not declare in `ui/initialize`. */
  | { kind: "display-mode-undeclared"; mode: DisplayMode; declared: DisplayMode[] }
  /** The app asked for a display mode the host does not offer. */
  | { kind: "display-mode-unavailable"; mode: DisplayMode; available: DisplayMode[] }

const list = (modes: DisplayMode[]) => modes.join(", ") || "none"

/** A failure's sentence, for a person. Branch on `failure.kind`, never on this. */
export function describeFailure(failure: BridgeFailure): string {
  switch (failure.kind) {
    case "host-error":
      return `${failure.method}: the host answered error ${failure.code}: ${failure.message}`
    case "refused":
      return `${failure.method}: the host refused`
    case "malformed-result":
      return `${failure.method}: the host's answer is malformed: ${failure.reason}`
    case "not-sent":
      return `${failure.method}: could not be sent: ${failure.reason}`
    case "not-connected":
      return `${failure.method}: the bridge is ${failure.status}, not connected`
    case "torn-down":
      return `${failure.method}: the host tore the app down before answering`
    case "closed":
      return `${failure.method}: the bridge was closed before the host answered`
    case "aborted":
      return `${failure.method}: aborted`
    case "protocol-version":
      return `ui/initialize: the host speaks protocol ${failure.offered}, and this app ${failure.spoken}`
    case "display-mode-undeclared":
      return `ui/request-display-mode: ${failure.mode} is not one the app declared (${list(failure.declared)})`
    case "display-mode-unavailable":
      return `ui/request-display-mode: the host offers ${list(failure.available)}, not ${failure.mode}`
  }
}

/** The error a failed call rejects with; `failure` says which case. */
export class BridgeError extends Error {
  readonly failure: BridgeFailure
  constructor(failure: BridgeFailure) {
    super(describeFailure(failure))
    this.name = "BridgeError"
    this.failure = failure
  }
}

export type HostViolation =
  /** A message that is not JSON-RPC 2.0. */
  | { kind: "invalid-message"; reason: string }
  /** A notification or request whose params are not the method's. */
  | { kind: "malformed-params"; method: string; reason: string }
  /** Optional fields left out because they were malformed. */
  | { kind: "dropped-fields"; method: string; fields: string[] }
  /** A notification before the app's `ui/notifications/initialized`. */
  | { kind: "before-initialized"; method: string }
  /** A response to no request the app made. */
  | { kind: "unknown-response"; id: RequestId }
  /** The tool's notifications in an order the standard does not allow. */
  | { kind: "tool-order"; method: string; phase: string }
