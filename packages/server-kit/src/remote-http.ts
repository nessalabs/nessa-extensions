/** Explicit remote resource-server mount; the host owns HTTPS and listener lifetime. */
import type { IncomingMessage, ServerResponse } from "node:http"

import { toNodeHandler } from "@modelcontextprotocol/node"
import {
  OAuthError,
  OAuthErrorCode,
  buildOAuthProtectedResourceMetadata,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
  type AuthInfo,
  type OAuthMetadata,
} from "@modelcontextprotocol/server"

import type { Extension } from "./definition.ts"
import { serverFactory } from "./server.ts"

/** Trusted startup configuration supplied by the host, not request headers. */
export interface RemoteHttpOptions {
  /** Canonical external HTTPS resource URL, including the MCP path. */
  readonly publicUrl: URL
  /** Exact canonical Host header values (including an explicit nondefault port). */
  readonly allowedHosts: readonly string[]
  /** Exact HTTPS Origin header values. An empty list refuses any present Origin. */
  readonly allowedOrigins: readonly string[]
  /** The 1–16 OAuth scopes required on every request and published for discovery. */
  readonly requiredScopes: readonly string[]
  /** The host authorization server metadata; only its issuer is published here. */
  readonly oauthMetadata: OAuthMetadata
  /**
   * Verify token validity, issuer, audience, expiry and host access policy for
   * this resource. Return the verified audience as `resource`, not a value
   * copied from the request. The verifier should enforce its own I/O deadline.
   */
  readonly verifyAccessToken: (
    token: string,
    resource: string,
  ) => Promise<AuthInfo & { resource: URL }>
  /** Reports SDK transport faults, not caller credentials. */
  readonly onerror?: (error: Error) => void
}

/** A remote route and its MCP shutdown owner. The caller closes the HTTP server. */
export interface RemoteHttpMount {
  handle(request: IncomingMessage, response: ServerResponse): void
  close(): Promise<void>
}

function httpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
}

function canonicalHost(value: string): boolean {
  try {
    const url = new URL(`https://${value}`)
    return httpsUrl(url) && value === url.host
  } catch {
    return false
  }
}

function canonicalOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return httpsUrl(url) && value === url.origin
  } catch {
    return false
  }
}

/**
 * Mount on a dedicated host-owned HTTPS path or trusted TLS terminator. This
 * function creates no listener and does not read Forwarded headers. It serves
 * modern stateless HTTP only; the existing loopback and stdio entries are unchanged.
 */
export function mountRemoteHttp(
  extension: Extension,
  options: RemoteHttpOptions,
): RemoteHttpMount {
  const resource = new URL(options.publicUrl)
  const issuer = new URL(options.oauthMetadata.issuer)
  const hosts = new Set(options.allowedHosts)
  const origins = new Set(options.allowedOrigins)
  const verify = options.verifyAccessToken
  const scopes = Array.isArray(options.requiredScopes) ? [...options.requiredScopes] : []
  // RFC 6749 scope-token is printable ASCII except quote and backslash.
  const validScopes =
    scopes.length >= 1 &&
    scopes.length <= 16 &&
    new Set(scopes).size === scopes.length &&
    scopes.every(
      (scope) =>
        typeof scope === "string" &&
        scope.length >= 1 &&
        scope.length <= 128 &&
        !/[^\x21\x23-\x5b\x5d-\x7e]/.test(scope),
    )
  if (
    !httpsUrl(resource) ||
    !httpsUrl(issuer) ||
    !Array.isArray(options.allowedHosts) ||
    !hosts.has(resource.host) ||
    ![...hosts].every(canonicalHost) ||
    !Array.isArray(options.allowedOrigins) ||
    ![...origins].every(canonicalOrigin) ||
    !validScopes ||
    typeof verify !== "function"
  ) {
    throw new TypeError(
      "Remote HTTP requires trusted HTTPS resource, issuer, host/origin policy, scopes, and token verification",
    )
  }
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(resource)
  const metadataPath = new URL(metadataUrl).pathname
  if (resource.pathname === metadataPath) {
    throw new TypeError("MCP and OAuth discovery paths must differ")
  }
  const metadata = buildOAuthProtectedResourceMetadata({
    resourceServerUrl: resource,
    oauthMetadata: options.oauthMetadata,
    scopesSupported: scopes,
  })
  const serializedMetadata = JSON.stringify(metadata)
  const requireAuth = requireBearerAuth({
    resourceMetadataUrl: metadataUrl,
    requiredScopes: scopes,
    verifier: {
      async verifyAccessToken(token) {
        let auth: AuthInfo & { resource: URL }
        try {
          auth = await verify(token, resource.href)
        } catch (error) {
          // Preserve typed policy outcomes without including host verifier details.
          if (error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token")
          }
          if (
            error instanceof OAuthError &&
            error.code === OAuthErrorCode.InsufficientScope
          ) {
            throw new OAuthError(OAuthErrorCode.InsufficientScope, "Insufficient scope")
          }
          throw new OAuthError(
            OAuthErrorCode.ServerError,
            "Access verification unavailable",
          )
        }
        if (auth.resource?.href !== resource.href || !Number.isFinite(auth.expiresAt)) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token")
        }
        return { ...auth, resourceMetadataUrl: metadataUrl }
      },
    },
  })
  const reporting = options.onerror === undefined ? {} : { onerror: options.onerror }
  const endpoint = createMcpHandler(serverFactory(extension), {
    legacy: "reject",
    ...reporting,
  })
  const handle = toNodeHandler(
    {
      async fetch(request) {
        const auth = await requireAuth(request)
        return auth instanceof Response
          ? auth
          : endpoint.fetch(request, { authInfo: auth })
      },
    },
    reporting,
  )

  return {
    handle: (request, response) => {
      const host = request.headersDistinct.host ?? []
      const origin = request.headersDistinct.origin ?? []
      if (
        host.length !== 1 ||
        !hosts.has(host[0]) ||
        origin.length > 1 ||
        (origin.length === 1 && !origins.has(origin[0]))
      ) {
        response.writeHead(403).end()
        return
      }
      const target = request.url ?? ""
      if (!target.startsWith("/")) {
        response.writeHead(400).end()
        return
      }
      const path = target.split("?", 1)[0]
      if (path === metadataPath) {
        if (request.method === "GET") {
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(serializedMetadata)
        } else {
          response.writeHead(405, { allow: "GET" }).end()
        }
        return
      }
      if (path !== resource.pathname) {
        response.writeHead(404).end()
        return
      }
      if ((request.headersDistinct.authorization ?? []).length > 1) {
        response.writeHead(400).end()
        return
      }
      void handle(request, response)
    },
    close: () => endpoint.close(),
  }
}
