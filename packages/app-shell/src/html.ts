/**
 * Writing a value into an HTML attribute: the one rule both the build
 * (`build/inline.ts`) and the fake host (`fake-host/frame.ts`) use. Quoted
 * with `"`, so `&`, `"` and `<` are written as references.
 */
export const escapeAttribute = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
