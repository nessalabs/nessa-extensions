import { describe, expect, it } from "vitest"

import { appCsp, restrictiveCsp } from "./csp.ts"
import { withPolicy } from "./frame.ts"

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ")
      return [name, sources.join(" ")]
    }),
  )

describe("appCsp", () => {
  it("is the standard's restrictive default when the resource declares nothing", () => {
    expect(appCsp()).toBe(restrictiveCsp)
    expect(directives(restrictiveCsp)).toEqual({
      "default-src": "'none'",
      "script-src": "'self' 'unsafe-inline'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data:",
      "media-src": "'self' data:",
      "connect-src": "'none'",
      "frame-src": "'none'",
      "object-src": "'none'",
      "base-uri": "'self'",
    })
  })

  it("adds each declared origin where the standard's construction puts it", () => {
    expect(
      directives(
        appCsp({
          connectDomains: ["https://api.example.com", "wss://live.example.com"],
          resourceDomains: ["https://*.cdn.example"],
          frameDomains: ["https://www.youtube.com"],
          baseUriDomains: ["https://base.example"],
        }),
      ),
    ).toEqual({
      "default-src": "'none'",
      "script-src": "'self' 'unsafe-inline' https://*.cdn.example",
      "style-src": "'self' 'unsafe-inline' https://*.cdn.example",
      "connect-src": "'self' https://api.example.com wss://live.example.com",
      "img-src": "'self' data: https://*.cdn.example",
      "font-src": "'self' https://*.cdn.example",
      "media-src": "'self' data: https://*.cdn.example",
      "frame-src": "https://www.youtube.com",
      "object-src": "'none'",
      "base-uri": "https://base.example",
    })
  })

  it("leaves out a declared domain that is not an origin, so it cannot add a directive", () => {
    const policy = appCsp({
      connectDomains: [
        "https://ok.example",
        "*",
        "https://x.example; script-src *",
        "'unsafe-eval'",
      ],
    })
    expect(directives(policy)["connect-src"]).toBe("'self' https://ok.example")
    expect(policy).not.toContain("unsafe-eval")
  })
})

describe("withPolicy", () => {
  const meta = (policy: string) =>
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`

  it("puts the policy first in the head", () => {
    expect(
      withPolicy(
        '<!doctype html><html><head lang="en"><title>x</title></head></html>',
        "a 'b'",
      ),
    ).toBe(
      `<!doctype html><html><head lang="en">${meta("a 'b'")}<title>x</title></head></html>`,
    )
  })

  it("puts it first in a document without a head, and escapes it", () => {
    expect(withPolicy("<p>hi</p>", 'x"<')).toBe(`${meta("x&quot;&lt;")}<p>hi</p>`)
  })

  it("keeps a doctype first when there is no head, so the document stays in standards mode", () => {
    expect(withPolicy("<!DOCTYPE html><p>hi</p>", "p")).toBe(
      `<!DOCTYPE html>${meta("p")}<p>hi</p>`,
    )
  })

  it("does not take a <header> for the head", () => {
    expect(withPolicy("<header></header>", "p")).toBe(`${meta("p")}<header></header>`)
  })
})
