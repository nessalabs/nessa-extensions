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

  it("refuses, and does not change, code that holds its own closing tag", () => {
    const html = '<script src="a.js"></script><link rel="stylesheet" href="a.css">'
    const result = inlineIntoHtml(
      html,
      new Map([
        ["a.js", "const s = String.raw`</SCRIPT>`"],
        ["a.css", 'a::after{content:"</style>"}'],
      ]),
    )
    expect(result.unsafe).toEqual(["a.js", "a.css"])
    expect(result.html).toBe(html)
  })

  it("writes code in exactly as it is, an escaped closing tag included", () => {
    const code = 'const s = "<\\/script>", r = String.raw`a\\b`'
    const result = inlineIntoHtml(
      '<script src="a.js"></script>',
      new Map([["a.js", code]]),
    )
    expect(result.html).toBe(`<script>${code}</script>`)
  })

  it("reads only the page's own tags, never tag text inside the code it writes in", () => {
    const code =
      'const a = \'<link rel="stylesheet" href="./a.css">\', b = `<link rel="stylesheet" href="${font}">`'
    const result = inlineIntoHtml(
      '<script src="a.js"></script><link rel="stylesheet" href="./a.css">',
      new Map([
        ["a.js", code],
        ["a.css", "p{}"],
      ]),
    )
    expect(result.html).toBe(`<script>${code}</script><style>p{}</style>`)
    expect(result.unresolved).toEqual([])
  })

  it("leaves the page's own inline scripts, styles and comments exactly as they are", () => {
    const html =
      '<!-- <link rel="stylesheet" href="./a.css"> -->' +
      '<script>var s = \'<link rel="stylesheet" href="./a.css">\'</script>' +
      '<style>p::after{content:"<link rel=stylesheet href=./a.css>"}</style>'
    const result = inlineIntoHtml(html, new Map([["a.css", "p{}"]]))
    expect(result.html).toBe(html)
    expect(result.inlined.size).toBe(0)
  })

  it("refuses a tag whose attributes would mean nothing written inline", () => {
    const files = new Map([
      ["a.js", "1"],
      ["a.css", "p{}"],
    ])
    for (const [tag, why] of [
      ['<script nomodule src="a.js"></script>', "a.js (its nomodule attribute)"],
      ['<script defer src="a.js"></script>', "a.js (its defer attribute)"],
      [
        '<script type="text/javascript" src="a.js"></script>',
        "a.js (its type text/javascript)",
      ],
      [
        '<link rel="stylesheet" href="a.css" integrity="sha-x">',
        "a.css (its integrity attribute)",
      ],
    ] as const) {
      const result = inlineIntoHtml(tag, files)
      expect(result.unsafe).toEqual([why])
      expect(result.html).toBe(tag)
    }
  })

  it("resolves ./ against the page's own folder", () => {
    const result = inlineIntoHtml(
      '<script type="module" src="./b.js"></script>',
      new Map([
        ["app/b.js", "2"],
        ["b.js", "wrong"],
      ]),
      "app/index.html",
    )
    expect(result.html).toBe('<script type="module">2</script>')
  })

  it("resolves references against the page's own place in the bundle", () => {
    const result = inlineIntoHtml(
      '<script type="module" src="../assets/a.js"></script><link rel="stylesheet" href="/assets/a.css">',
      new Map([
        ["assets/a.js", "1"],
        ["assets/a.css", "p{}"],
      ]),
      "app/index.html",
    )
    expect(result.html).toBe('<script type="module">1</script><style>p{}</style>')
    expect([...result.inlined]).toEqual(["assets/a.js", "assets/a.css"])
    expect(result.unresolved).toEqual([])
  })

  it("lists an outside script as unresolved even when it has text inside", () => {
    const tag = '<script src="https://cdn.example/x.js">/* fallback */</script>'
    const result = inlineIntoHtml(tag, new Map())
    expect(result.unresolved).toEqual(["https://cdn.example/x.js"])
    expect(result.html).toBe(tag)
  })

  it("does not count a refused tag's file as written in", () => {
    const result = inlineIntoHtml(
      '<script defer src="a.js"></script>',
      new Map([["a.js", "1"]]),
    )
    expect(result.unsafe).toEqual(["a.js (its defer attribute)"])
    expect(result.inlined.size).toBe(0)
  })

  it("keeps a stylesheet's media", () => {
    const result = inlineIntoHtml(
      '<link rel="stylesheet" href="p.css" media="print">',
      new Map([["p.css", "body{color:black}"]]),
    )
    expect(result.html).toBe('<style media="print">body{color:black}</style>')
  })

  it("leaves <!-- as it is, since it means something in code", () => {
    const code = "const r = /<!--/u; const less = a<!--b"
    const result = inlineIntoHtml(
      '<script src="a.js"></script>',
      new Map([["a.js", code]]),
    )
    expect(result.html).toBe(`<script>${code}</script>`)
  })

  it("lists, and does not inline, a script with both <!-- and <script", () => {
    const result = inlineIntoHtml(
      '<script src="a.js"></script>',
      new Map([["a.js", 'const a = "<!--", b = "<script>"']]),
    )
    expect(result.unsafe).toEqual(["a.js"])
    expect(result.html).toBe('<script src="a.js"></script>')
  })

  it("does not inline another origin whose path matches a bundle file", () => {
    const tag = '<script src="https://cdn.example/assets/index-abc.js"></script>'
    const result = inlineIntoHtml(
      tag,
      new Map([["assets/index-abc.js", "console.log(1)"]]),
    )
    expect(result.unresolved).toEqual(["https://cdn.example/assets/index-abc.js"])
    expect(result.inlined.size).toBe(0)
    expect(result.html).toBe(tag)
  })

  it("does not inline a reference that carries a query", () => {
    const tag = '<script src="./a.js?v=1"></script>'
    const result = inlineIntoHtml(tag, new Map([["a.js", "1"]]))
    expect(result.unresolved).toEqual(["./a.js?v=1"])
    expect(result.inlined.size).toBe(0)
    expect(result.html).toBe(tag)
  })

  it("does not inline a reference that carries a hash", () => {
    const tag = '<script src="./a.js#part"></script>'
    const result = inlineIntoHtml(tag, new Map([["a.js", "1"]]))
    expect(result.unresolved).toEqual(["./a.js#part"])
    expect(result.inlined.size).toBe(0)
    expect(result.html).toBe(tag)
  })

  it("decodes a percent-encoded name before matching a bundle file", () => {
    const result = inlineIntoHtml(
      '<script src="./a%20b.js"></script>',
      new Map([
        ["a b.js", "decoded"],
        ["a%20b.js", "raw"],
      ]),
    )
    expect(result.html).toBe("<script>decoded</script>")
    expect([...result.inlined]).toEqual(["a b.js"])
    expect(result.unresolved).toEqual([])
  })

  it("lists a malformed percent escape as unresolved, and does not throw", () => {
    const tag = '<script src="a%zz.js"></script>'
    const files = new Map([["a%zz.js", "raw"]])
    expect(() => inlineIntoHtml(tag, files)).not.toThrow()
    const result = inlineIntoHtml(tag, files)
    expect(result.unresolved).toEqual(["a%zz.js"])
    expect(result.inlined.size).toBe(0)
    expect(result.html).toBe(tag)
  })

  it("counts a modulepreload as written in, and does not put its code in the page", () => {
    const result = inlineIntoHtml(
      '<link rel="modulepreload" href="./other.js">',
      new Map([["other.js", "console.log('from-the-preload')"]]),
    )
    expect(result.html).toBe("")
    expect(result.html).not.toContain("from-the-preload")
    expect([...result.inlined]).toEqual(["other.js"])
    expect(result.unresolved).toEqual([])
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
