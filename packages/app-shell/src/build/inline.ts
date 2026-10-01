/**
 * An app's built HTML with its scripts and stylesheets written into it, so
 * the app is one file: what its `ui://` resource serves, and what a host's
 * default policy lets run (scripts and styles inline; nothing fetched).
 * Pure: the build plugin (`mcp-app.ts`) gives it the HTML and the bundle's
 * files, and refuses the build on whatever it could not inline.
 */
import { escapeAttribute } from "../html.ts"

export interface Inlined {
  html: string
  /** The bundle's files now in the HTML. */
  inlined: Set<string>
  /** Each `src` or `href` of a script or stylesheet that names no file of the bundle. */
  unresolved: string[]
  /**
   * Each script or stylesheet that cannot be written inline as it is, left in
   * place for the build to refuse: its text would end early (`endsEarly`), or
   * its tag carries an attribute that would mean nothing inline.
   */
  unsafe: string[]
}

/**
 * Whether `text`, written inline as an element's contents, would not end
 * where it is written: it holds the element's closing tag, or — for a script
 * — both `<!--` and `<script`, which put the HTML parser in a state where
 * `</script>` does not end it. Such text is refused rather than rewritten:
 * no escape reads the same everywhere in code (a raw template keeps the
 * backslash, `a<!--b` is an expression), so the inliner never changes what
 * it writes in. Bundlers already write `<\/script` inside strings.
 */
function endsEarly(text: string, element: "script" | "style"): boolean {
  if (new RegExp(`</${element}`, "i").test(text)) return true
  return element === "script" && text.includes("<!--") && /<script/i.test(text)
}

const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag)
  return match === null ? undefined : (match[1] ?? match[2] ?? match[3])
}

/** Every attribute name in `tag`, lower-cased. */
const attributeNames = (tag: string): string[] =>
  [
    ...tag
      .replace(/^<[a-z]+/i, "")
      .matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g),
  ].map((match) => (match[1] ?? "").toLowerCase())

/**
 * The attributes the inliner carries over or that mean nothing once inlined
 * (`crossorigin`, `href`, `src`, `rel`), by element. A tag with any other —
 * `defer`, `nomodule`, `integrity`, a classic `type` — is refused, since its
 * meaning would be lost written inline.
 */
const understood = {
  script: new Set(["src", "type", "crossorigin"]),
  stylesheet: new Set(["rel", "href", "media", "crossorigin"]),
  modulepreload: new Set(["rel", "href", "crossorigin"]),
}

const unknownAttribute = (tag: string, known: ReadonlySet<string>) =>
  attributeNames(tag).find((name) => !known.has(name))

/** A built file's name from how the HTML refers to it: `./assets/x.js` or `/assets/x.js`. */
const fileName = (reference: string) => reference.replace(/^\.?\//, "")

/**
 * `html` with each `<script src>` and `<link rel="stylesheet">` that names a
 * file in `files` replaced by the file's contents, and each
 * `<link rel="modulepreload">` of one removed.
 */
export function inlineIntoHtml(
  html: string,
  files: ReadonlyMap<string, string>,
): Inlined {
  const inlined = new Set<string>()
  const unresolved: string[] = []
  const unsafe: string[] = []
  const take = (reference: string | undefined): string | undefined => {
    if (reference === undefined) return undefined
    const name = fileName(reference)
    const contents = files.get(name)
    if (contents === undefined) unresolved.push(reference)
    else inlined.add(name)
    return contents
  }
  const refuse = (tag: string, why: string) => {
    unsafe.push(why)
    return tag
  }
  const script = (element: string, tag: string, body: string) => {
    const src = attribute(tag, "src")
    // An inline script is the page's own: left exactly as it is.
    if (src === undefined || body.trim() !== "") return element
    const code = take(src)
    if (code === undefined) return element
    const extra = unknownAttribute(tag, understood.script)
    if (extra !== undefined) return refuse(element, `${src} (its ${extra} attribute)`)
    const type = attribute(tag, "type")
    if (type !== undefined && type.toLowerCase() !== "module") {
      return refuse(element, `${src} (its type ${type})`)
    }
    if (endsEarly(code, "script")) return refuse(element, src)
    return `<script${type === undefined ? "" : ' type="module"'}>${code}</script>`
  }
  const link = (tag: string) => {
    const rel = attribute(tag, "rel")?.toLowerCase()
    const href = attribute(tag, "href")
    if (rel === "stylesheet") {
      const css = take(href)
      if (css === undefined || href === undefined) return tag
      const extra = unknownAttribute(tag, understood.stylesheet)
      if (extra !== undefined) return refuse(tag, `${href} (its ${extra} attribute)`)
      if (endsEarly(css, "style")) return refuse(tag, href)
      const media = attribute(tag, "media")
      const scoped = media === undefined ? "" : ` media="${escapeAttribute(media)}"`
      return `<style${scoped}>${css}</style>`
    }
    if (rel === "modulepreload") {
      if (take(href) === undefined) return tag
      const extra = unknownAttribute(tag, understood.modulepreload)
      return extra === undefined ? "" : refuse(tag, `${href} (its ${extra} attribute)`)
    }
    return tag
  }
  // One pass over the page as built. A comment, an inline script and an
  // inline style are matched whole and kept as they are, so text inside them
  // that looks like a tag is never read as one; and what is written in is
  // never read again.
  const out = html.replace(
    /<!--[\s\S]*?-->|(<script\b[^>]*>)([\s\S]*?)<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi,
    (element, scriptTag: string | undefined, body: string | undefined) => {
      if (scriptTag !== undefined) return script(element, scriptTag, body ?? "")
      return /^<link/i.test(element) ? link(element) : element
    },
  )
  return { html: out, inlined, unresolved, unsafe }
}
