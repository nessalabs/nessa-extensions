/**
 * The Content Security Policy a host gives an app, built from its resource's
 * `_meta.ui.csp` exactly as SEP-1865 constructs it ("Content Security Policy
 * Enforcement"): with nothing declared, scripts, styles, images and media
 * from the app's own document only, fonts and connections from nowhere.
 * The fake host loads an app under it, so an app that needs more than it
 * declares fails in tests as it would in a real host.
 */

export interface ResourceCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

/** A CSP source: an origin, possibly with a wildcard subdomain. Anything else is refused. */
const source = /^(https?|wss?):\/\/(\*\.)?[A-Za-z0-9.-]+(:\d+)?$/

/** The declared domains that are sources; the rest are left out, not trusted into the policy. */
function sources(domains: string[] | undefined): string[] {
  return (domains ?? []).filter((domain) => source.test(domain))
}

/**
 * The policy for a resource that declares nothing: SEP-1865's "Restrictive
 * Default", with the sandbox proxy's `frame-src 'none'`, `object-src 'none'`
 * and `base-uri 'self'`.
 */
export const restrictiveCsp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ")

/** The policy for a resource's `_meta.ui.csp`; `restrictiveCsp` when it declares none. */
export function appCsp(csp?: ResourceCsp): string {
  if (csp === undefined) return restrictiveCsp
  const resources = sources(csp.resourceDomains)
  const connect = sources(csp.connectDomains)
  const frames = sources(csp.frameDomains)
  const bases = sources(csp.baseUriDomains)
  const join = (...parts: string[]) => parts.filter((part) => part !== "").join(" ")
  return [
    "default-src 'none'",
    `script-src ${join("'self'", "'unsafe-inline'", ...resources)}`,
    `style-src ${join("'self'", "'unsafe-inline'", ...resources)}`,
    `connect-src ${join("'self'", ...connect)}`,
    `img-src ${join("'self'", "data:", ...resources)}`,
    `font-src ${join("'self'", ...resources)}`,
    `media-src ${join("'self'", "data:", ...resources)}`,
    `frame-src ${frames.length > 0 ? frames.join(" ") : "'none'"}`,
    "object-src 'none'",
    `base-uri ${bases.length > 0 ? bases.join(" ") : "'self'"}`,
  ].join("; ")
}
