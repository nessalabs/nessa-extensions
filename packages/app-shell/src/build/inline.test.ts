import { describe, expect, it } from "vitest"

import { inlineIntoHtml } from "./inline.ts"

describe("inlineIntoHtml", () => {
  const html = [
    "<!doctype html><html><head>",
    '<script type="module" crossorigin src="./assets/index-a1.js"></script>',
    '<link rel="modulepreload" href="./assets/index-a1.js">',
    '<link rel="stylesheet" crossorigin href="/assets/index-b2.css">',
    '<link rel="icon" href="data:,">',
    "</head><body><div id=root></div></body></html>",
  ].join("")

  it("writes the script and stylesheet in and removes their preload", () => {
    const files = new Map([
      ["assets/index-a1.js", "console.log(1)"],
      ["assets/index-b2.css", "body{color:red}"],
    ])
    const result = inlineIntoHtml(html, files)
    expect(result.html).toBe(
      [
        "<!doctype html><html><head>",
        '<script type="module">console.log(1)</script>',
        "<style>body{color:red}</style>",
        '<link rel="icon" href="data:,">',
        "</head><body><div id=root></div></body></html>",
      ].join(""),
    )
    expect([...result.inlined]).toEqual(["assets/index-a1.js", "assets/index-b2.css"])
    expect(result.unresolved).toEqual([])
  })

  it("keeps code that names its closing tag from ending the element", () => {
    const result = inlineIntoHtml(
      '<script src="a.js"></script><link rel="stylesheet" href="a.css">',
      new Map([
        ["a.js", 'const s = "</script><script>alert(1)</SCRIPT>"; // <!-- x'],
        ["a.css", 'a::after{content:"</style>"}'],
      ]),
    )
    expect(result.html).toBe(
      '<script>const s = "<\\/script><script>alert(1)<\\/SCRIPT>"; // <\\!-- x</script>' +
        '<style>a::after{content:"<\\/style>"}</style>',
    )
  })

  it("leaves a reference to no file of the bundle in place, and lists it", () => {
    const result = inlineIntoHtml(
      '<script src="https://cdn.example/x.js"></script><link rel="stylesheet" href="missing.css">',
      new Map(),
    )
    expect(result.unresolved).toEqual(["https://cdn.example/x.js", "missing.css"])
    expect(result.inlined.size).toBe(0)
  })

  it("leaves an inline script alone", () => {
    const tag = "<script>window.x = 1</script>"
    expect(inlineIntoHtml(tag, new Map()).html).toBe(tag)
  })
})
