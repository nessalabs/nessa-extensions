import { createServer, request as httpRequest, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { mountRemoteHttp, type RemoteHttpOptions } from "./remote-http.ts"
import { apps, capabilitiesFor, sample } from "./testing.ts"

const publicUrl = new URL("https://extension.example/mcp/v1")
const allowedOrigin = "https://host.example"
const requiredScopes = ["mcp:read", "mcp:use"]
const metadataPath = "/.well-known/oauth-protected-resource/mcp/v1"

function options(): RemoteHttpOptions {
  return {
    publicUrl,
    allowedHosts: [publicUrl.host],
    allowedOrigins: [allowedOrigin],
    requiredScopes,
    oauthMetadata: {
      issuer: "https://issuer.example",
      authorization_endpoint: "https://issuer.example/authorize",
      token_endpoint: "https://issuer.example/token",
      response_types_supported: ["code"],
    },
    verifyAccessToken: async (token, resource) => {
      if (token === "unknown") {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "internal verifier detail")
      }
      if (token === "unavailable") throw new Error("internal verifier detail")
      return {
        token,
        clientId: "fixture",
        scopes: token === "unscoped" ? ["mcp:read"] : requiredScopes,
        expiresAt: token === "expired" ? 0 : 4_000_000_000,
        resource: new URL(
          token === "wrong-audience" ? "https://other.example/mcp" : resource,
        ),
      }
    },
  }
}

const opened: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of opened.splice(0).reverse()) await close()
})

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
}

async function serving(change: Partial<RemoteHttpOptions> = {}) {
  // A host owns the listener. This disposable loopback fixture is the only
  // plaintext listener; no credential or TLS termination is configured in kit.
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  opened.push(() => closeServer(server))
  const { port } = server.address() as AddressInfo
  const loopback = new URL(`http://127.0.0.1:${port}`)
  const configured = options()
  const verifyAccessToken = vi.fn(configured.verifyAccessToken)
  const mount = mountRemoteHttp(sample, {
    ...configured,
    allowedHosts: [...configured.allowedHosts, loopback.host],
    verifyAccessToken,
    ...change,
  })
  server.on("request", mount.handle)
  opened.push(mount.close)
  return { loopback, verifyAccessToken }
}

describe("mountRemoteHttp", () => {
  it.each([
    { publicUrl: new URL("http://extension.example/mcp") },
    { publicUrl: new URL("https://user@extension.example/mcp") },
    { publicUrl: new URL("https://extension.example/mcp?extra=1") },
    { allowedHosts: [] },
    { allowedHosts: [publicUrl.host, "other.example/path"] },
    { allowedOrigins: undefined },
    { allowedOrigins: ["http://host.example"] },
    { allowedOrigins: ["https://host.example/path"] },
    { oauthMetadata: { ...options().oauthMetadata, issuer: "http://localhost" } },
    { requiredScopes: undefined },
    { requiredScopes: [] },
    { requiredScopes: ["mcp:read", "mcp:read"] },
    { requiredScopes: ["two words"] },
    { requiredScopes: ["scope\n"] },
    { requiredScopes: ["scope".repeat(30)] },
    { requiredScopes: Array.from({ length: 17 }, (_, n) => `scope:${n}`) },
    { verifyAccessToken: undefined },
  ])("refuses incomplete or noncanonical trust configuration (%j)", (change) => {
    expect(() =>
      mountRemoteHttp(sample, { ...options(), ...change } as RemoteHttpOptions),
    ).toThrow(TypeError)
  })

  it("rejects host and origin before token verification and ignores forwarding headers", async () => {
    const { loopback, verifyAccessToken } = await serving()
    const target = new URL(publicUrl.pathname, loopback)
    for (const headers of [
      { host: "other.example", "x-forwarded-host": publicUrl.host },
      { origin: "https://host.example:8443", "x-forwarded-proto": "https" },
      { origin: "null" },
    ]) {
      // Fetch can replace a supplied Host; use the Node wire client here.
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          target,
          { headers: { authorization: "Bearer fixture", ...headers } },
          (response) => {
            response.resume()
            response.once("end", () => resolve(response.statusCode ?? 0))
          },
        )
        request.once("error", reject)
        request.end()
      })
      expect(status).toBe(403)
    }
    expect(verifyAccessToken).not.toHaveBeenCalled()
  })

  it("serves public path-specific discovery and challenges without leaking verifier details", async () => {
    const { loopback } = await serving()
    const discovery = await fetch(new URL(metadataPath, loopback))
    expect(discovery.status).toBe(200)
    expect(await discovery.json()).toEqual({
      resource: publicUrl.href,
      authorization_servers: ["https://issuer.example"],
      scopes_supported: requiredScopes,
    })
    const discoveryWrite = await fetch(new URL(metadataPath, loopback), {
      method: "POST",
    })
    expect(discoveryWrite.status).toBe(405)
    expect(discoveryWrite.headers.get("allow")).toBe("GET")
    expect((await fetch(new URL("/unmounted", loopback))).status).toBe(404)
    const target = new URL(publicUrl.pathname, loopback)
    for (const token of [undefined, "unknown", "wrong-audience", "expired"]) {
      const response = await fetch(target, {
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      })
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toContain(
        `resource_metadata="https://extension.example${metadataPath}"`,
      )
      expect(await response.text()).not.toContain("internal verifier detail")
    }
    const unscoped = await fetch(target, {
      headers: { authorization: "Bearer unscoped" },
    })
    expect(unscoped.status).toBe(403)
    expect(unscoped.headers.get("www-authenticate")).toContain("insufficient_scope")
    expect(unscoped.headers.get("www-authenticate")).toContain('scope="mcp:read mcp:use"')
    expect(await unscoped.text()).not.toContain("internal verifier detail")
    const unavailable = await fetch(target, {
      headers: { authorization: "Bearer unavailable" },
    })
    expect(unavailable.status).toBe(500)
    expect(await unavailable.text()).not.toContain("internal verifier detail")
  })

  it("lets a modern SDK client list, call, and read the view on the mounted path", async () => {
    const { loopback, verifyAccessToken } = await serving()
    const client = new Client(
      { name: "remote fixture", version: "1" },
      {
        capabilities: capabilitiesFor({ era: "modern", mimeTypes: apps }),
        versionNegotiation: { mode: { pin: "2026-07-28" } },
      },
    )
    opened.push(() => client.close())
    await client.connect(
      new StreamableHTTPClientTransport(new URL(publicUrl.pathname, loopback), {
        requestInit: {
          headers: { authorization: "Bearer fixture", origin: allowedOrigin },
        },
      }),
    )
    expect((await client.listTools()).tools.map(({ name }) => name)).toContain(
      "show_board",
    )
    const result = await client.callTool({ name: "show_board", arguments: { rows: 2 } })
    expect(result.content).toEqual([{ type: "text", text: "2 rows" }])
    const view = await client.readResource({ uri: "ui://sample/board" })
    expect(view.contents[0]).toMatchObject({
      mimeType: "text/html;profile=mcp-app",
      text: "<!doctype html><html><body>board</body></html>",
    })
    expect(verifyAccessToken.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(
      verifyAccessToken.mock.calls.every(
        ([token, audience]) => token === "fixture" && audience === publicUrl.href,
      ),
    ).toBe(true)
  })

  it("authenticates requests without Origin but does not opt in to legacy HTTP", async () => {
    const { loopback, verifyAccessToken } = await serving({ allowedOrigins: [] })
    const response = await fetch(new URL(publicUrl.pathname, loopback), {
      method: "POST",
      headers: {
        authorization: "Bearer fixture",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "fixture", version: "1" },
        },
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: -32022 } })
    expect(verifyAccessToken).toHaveBeenCalledWith("fixture", publicUrl.href)
  })
})
