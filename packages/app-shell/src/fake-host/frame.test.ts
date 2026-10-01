// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"

import { appCsp, restrictiveCsp } from "./csp.ts"
import { mountFakeHostFrame } from "./frame.ts"

afterEach(() => {
  document.body.replaceChildren()
})

describe("mountFakeHostFrame", () => {
  it("puts the app in an iframe sandboxed to scripts alone, under the restrictive policy", () => {
    const container = document.createElement("div")
    document.body.append(container)
    const { iframe, host, remove } = mountFakeHostFrame({
      container,
      html: "<!doctype html><html><head></head><body>app</body></html>",
    })
    expect(container.contains(iframe)).toBe(true)
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts")
    expect(iframe.getAttribute("srcdoc")).toBe(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${restrictiveCsp}"></head><body>app</body></html>`,
    )
    expect(host.stage).toBe("waiting")
    remove()
    expect(container.contains(iframe)).toBe(false)
  })

  it("uses the resource's declared policy", () => {
    const container = document.createElement("div")
    const csp = { connectDomains: ["https://api.example.com"] }
    const { iframe } = mountFakeHostFrame({ container, html: "<p>x</p>", csp })
    expect(iframe.getAttribute("srcdoc")).toContain(appCsp(csp))
  })
})
