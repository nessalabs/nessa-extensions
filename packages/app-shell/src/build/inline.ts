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

const bundleOrigin = "https://bundle.invalid"

/**
 * The bundle file a reference in the page names, resolved against the page's
 * own place in the bundle (`./x.js`, `../assets/x.js`, `/assets/x.js`), or
 * undefined for one outside it: another origin, a query, a hash, or a
 * percent-encoding that does not decode (`inline.test.ts`).
 */
function fileName(reference: string, page: string): string | undefined {
  try {
    const url = new URL(reference, `${bundleOrigin}/${page}`)
    if (url.origin !== bundleOrigin || url.search !== "" || url.hash !== "")
      return undefined
    return decodeURIComponent(url.pathname.slice(1))
  } catch {
    return undefined
  }
}

/**
 * `html`, the bundle's file `page`, with each `<script src>` and
 * `<link rel="stylesheet">` that names a file in `files` replaced by the
 * file's contents, and each `<link rel="modulepreload">` of one removed.
 */
export function inlineIntoHtml(
  html: string,
  files: ReadonlyMap<string, string>,
  page = "index.html",
): Inlined {
  const inlined = new Set<string>()
  const unresolved: string[] = []
  const unsafe: string[] = []
  /** The file a reference names, and its contents; listed unresolved if none. */
  const find = (reference: string | undefined) => {
    if (reference === undefined) return undefined
    const name = fileName(reference, page)
    const contents = name === undefined ? undefined : files.get(name)
    if (name === undefined || contents === undefined) {
      unresolved.push(reference)
      return undefined
    }
    return { name, contents }
  }
  /** Writes a file in: it is in the page now, and leaves the bundle. */
  const written = (name: string, element: string) => {
    inlined.add(name)
    return element
  }
  const refuse = (tag: string, why: string) => {
    unsafe.push(why)
    return tag
  }
  const script = (element: string, tag: string) => {
    const src = attribute(tag, "src")
    // An inline script is the page's own: left exactly as it is.
    if (src === undefined) return element
    // With a `src`, a script's own text never runs; it is not kept.
    const file = find(src)
    if (file === undefined) return element
    const extra = unknownAttribute(tag, understood.script)
    if (extra !== undefined) return refuse(element, `${src} (its ${extra} attribute)`)
    const type = attribute(tag, "type")
    if (type !== undefined && type.toLowerCase() !== "module") {
      return refuse(element, `${src} (its type ${type})`)
    }
    if (endsEarly(file.contents, "script")) return refuse(element, src)
    const module = type === undefined ? "" : ' type="module"'
    return written(file.name, `<script${module}>${file.contents}</script>`)
  }
  const link = (tag: string) => {
    const rel = attribute(tag, "rel")?.toLowerCase()
    const href = attribute(tag, "href")
    if (rel === "stylesheet") {
      const file = find(href)
      if (file === undefined || href === undefined) return tag
      const extra = unknownAttribute(tag, understood.stylesheet)
      if (extra !== undefined) return refuse(tag, `${href} (its ${extra} attribute)`)
      if (endsEarly(file.contents, "style")) return refuse(tag, href)
      const media = attribute(tag, "media")
      const scoped = media === undefined ? "" : ` media="${escapeAttribute(media)}"`
      return written(file.name, `<style${scoped}>${file.contents}</style>`)
    }
    if (rel === "modulepreload") {
      const file = find(href)
      if (file === undefined) return tag
      const extra = unknownAttribute(tag, understood.modulepreload)
      // Removed, and counted written, though its code is not copied in: a
      // preload does not run, and the tag would be a fetch (`inline.test.ts`).
      return extra === undefined
        ? written(file.name, "")
        : refuse(tag, `${href} (its ${extra} attribute)`)
    }
    return tag
  }
  // One pass over the page as built. A comment, a script and an inline style
  // are matched whole, so text inside them that looks like a tag is never
  // read as one; and what is written in is never read again.
  const out = html.replace(
    /<!--[\s\S]*?-->|(<script\b[^>]*>)[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi,
    (element, scriptTag: string | undefined) => {
      if (scriptTag !== undefined) return script(element, scriptTag)
      return /^<link/i.test(element) ? link(element) : element
    },
  )
  return { html: out, inlined, unresolved, unsafe }
}
