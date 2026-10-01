/**
 * The fake host in a browser: the app's HTML in a sandboxed iframe, under the
 * policy a host would give it, with a fake host on the other end. For
 * Playwright, and for a Storybook story, which renders into the element it
 * is given:
 *
 * ```ts
 * const { host } = mountFakeHostFrame({ container, html, context: { theme: "dark" } })
 * ```
 *
 * The iframe is `sandbox="allow-scripts"` without `allow-same-origin`, so the
 * app runs on an opaque origin with no access to the page, as a native host
 * renders it (SEP-1865's "Desktop/Native hosts" path; a web host's sandbox
 * proxy is the host's own concern, not the app's). The policy is set by a
 * `<meta>` as the document's first element, so it governs every script and
 * style the app carries.
 */
import { windowPairTransport } from "../protocol/transport.ts"
import { appCsp, type ResourceCsp } from "./csp.ts"
import { createFakeHost, type FakeHost, type FakeHostOptions } from "./fake-host.ts"

export interface FakeHostFrameOptions extends Omit<FakeHostOptions, "transport"> {
  /** Where the iframe goes. */
  container: Element
  /** The app's HTML: what its `ui://` resource's `resources/read` returns. */
  html: string
  /** The resource's `_meta.ui.csp`; none declared if left out. */
  csp?: ResourceCsp
}

const escapeAttribute = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

/** `html` with the policy as the first thing in its `<head>`. */
export function withPolicy(html: string, policy: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head !== null) {
    const end = head.index + head[0].length
    return html.slice(0, end) + meta + html.slice(end)
  }
  return meta + html
}

export function mountFakeHostFrame(options: FakeHostFrameOptions): {
  host: FakeHost
  iframe: HTMLIFrameElement
  remove: () => void
} {
  const { container, html, csp, onSize, ...hostOptions } = options
  const document = container.ownerDocument
  const window = document.defaultView
  if (window === null) throw new Error("the container is not in a window's document")
  const iframe = document.createElement("iframe")
  iframe.setAttribute("sandbox", "allow-scripts")
  iframe.setAttribute("title", "MCP App")
  iframe.style.border = "0"
  iframe.style.width = "100%"
  const host = createFakeHost({
    ...hostOptions,
    transport: windowPairTransport(window, () => iframe.contentWindow),
    onSize(size) {
      iframe.style.height = `${size.height}px`
      onSize?.(size)
    },
  })
  iframe.srcdoc = withPolicy(html, appCsp(csp))
  container.append(iframe)
  return {
    host,
    iframe,
    remove() {
      host.close()
      iframe.remove()
    },
  }
}
