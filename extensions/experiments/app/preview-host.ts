/**
 * The fake host the screenshots run in. It puts the built preview in a
 * sandboxed iframe and sends the sample as the tool input once the app has
 * initialized. Playwright calls `startPreview`.
 */
import { mountFakeHostFrame } from "@nessalabs/app-shell/fake-host"

let remove: (() => void) | undefined

Object.assign(window, {
  async startPreview(html: string, sample: "checkout" | "latency") {
    remove?.()
    const container = document.getElementById("host")
    if (container === null) return
    const mounted = mountFakeHostFrame({
      container,
      html,
      context: { theme: "light", availableDisplayModes: ["inline", "fullscreen"] },
    })
    remove = mounted.remove
    await mounted.host.initialized
    mounted.host.sendToolInput({ sample })
  },
})
