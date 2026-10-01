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
   * place for the build to refuse (`endsEarly`).
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
  const script = (tag: string) => {
    const src = attribute(tag, "src")
    if (src === undefined) return tag
    const code = take(src)
    if (code === undefined) return tag
    if (endsEarly(code, "script")) {
      unsafe.push(src)
      return tag
    }
    const module = /\stype\s*=\s*["']?module/i.test(tag) ? ' type="module"' : ""
    return `<script${module}>${code}</script>`
  }
  const link = (tag: string) => {
    const rel = attribute(tag, "rel")?.toLowerCase()
    if (rel === "stylesheet") {
      const href = attribute(tag, "href")
      const css = take(href)
      if (css === undefined || href === undefined) return tag
      if (endsEarly(css, "style")) {
        unsafe.push(href)
        return tag
      }
      const media = attribute(tag, "media")
      const scoped = media === undefined ? "" : ` media="${escapeAttribute(media)}"`
      return `<style${scoped}>${css}</style>`
    }
    if (rel === "modulepreload") {
      return take(attribute(tag, "href")) === undefined ? tag : ""
    }
    return tag
  }
  // One pass over the page as built, so what is written in — the app's own
  // code, which may hold text like a tag — is never read as the page.
  const out = html.replace(/<script\b[^>]*>\s*<\/script>|<link\b[^>]*>/gi, (tag) =>
    /^<script/i.test(tag) ? script(tag) : link(tag),
  )
  return { html: out, inlined, unresolved, unsafe }
}
