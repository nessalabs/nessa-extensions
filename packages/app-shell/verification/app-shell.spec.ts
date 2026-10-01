/// <reference types="node" />
/**
 * The fixture app in real browsers, in two hosts. Each contract is asserted
 * with numbers read from the page — computed colours, the iframe's height,
 * console errors — and each run prints one JSON line of measurements on
 * stdout. The contracts are listed in this directory's README.
 */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { dist } from "./build.ts"
import type { Scenario } from "./hosts/fake.ts"

const origin = "http://app-shell.test"

/** Serves `verification/dist` at `origin`, and collects every console error. */
async function serve(page: Page) {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = await readFile(join(dist, path))
    const type = path.endsWith(".html")
      ? "text/html"
      : path.endsWith(".js")
        ? "text/javascript"
        : "application/octet-stream"
    await route.fulfill({ body, contentType: type })
  })
  return errors
}

const app = (page: Page) => page.frameLocator("iframe")
const field = (page: Page, id: string) => app(page).getByTestId(id)
const cardStyle = (page: Page, property: "backgroundColor" | "color") =>
  field(page, "card").evaluate(
    (element, name) => getComputedStyle(element)[name],
    property,
  )

const report = (name: string, measurements: Record<string, unknown>) =>
  console.log(
    JSON.stringify({
      contract: name,
      browser: test.info().project.name,
      ...measurements,
    }),
  )

async function startFake(page: Page, scenario: Scenario) {
  const errors = await serve(page)
  await page.goto(`${origin}/hosts/fake.html`)
  const started = Date.now()
  await page.evaluate((s) => window.startFakeHost(s), scenario)
  await expect(field(page, "status")).toHaveText("connected")
  return { errors, connectedMs: Date.now() - started }
}

const weather = {
  input: { city: "Oslo" },
  outcome: {
    result: {
      content: [{ type: "text" as const, text: "4°C" }],
      structuredContent: { temperature: 4 },
    },
  },
}

test.describe("in the fake host", () => {
  test("renders the tool call under the standard's default policy, with no console errors", async ({
    page,
  }) => {
    const { errors, connectedMs } = await startFake(page, { tool: weather })
    await expect(field(page, "city")).toHaveText("Oslo")
    await expect(field(page, "result")).toHaveText('{"temperature":4}')
    await expect(field(page, "phase")).toHaveText("complete")
    const violations = await page.evaluate(() => window.fakeHost.violations.length)
    expect(violations).toBe(0)
    expect(errors).toEqual([])
    report("renders", {
      connectedMs,
      consoleErrors: errors.length,
      hostViolations: violations,
    })
  })

  test("follows a changed styles.variables theme, and reverts what the change leaves out", async ({
    page,
  }) => {
    await startFake(page, {
      context: {
        theme: "light",
        styles: {
          variables: {
            "--color-background-primary": "rgb(250, 250, 250)",
            "--color-text-primary": "rgb(10, 10, 10)",
          },
        },
      },
    })
    const before = {
      background: await cardStyle(page, "backgroundColor"),
      text: await cardStyle(page, "color"),
    }
    expect(before).toEqual({ background: "rgb(250, 250, 250)", text: "rgb(10, 10, 10)" })

    await page.evaluate(() =>
      window.fakeHost.changeContext({
        styles: { variables: { "--color-background-primary": "rgb(10, 20, 30)" } },
      }),
    )
    await expect.poll(() => cardStyle(page, "backgroundColor")).toBe("rgb(10, 20, 30)")
    // Left out of the change: back to the app's default (the stand-in's rgb(37, 37, 37)).
    const after = {
      background: await cardStyle(page, "backgroundColor"),
      text: await cardStyle(page, "color"),
    }
    expect(after).toEqual({ background: "rgb(10, 20, 30)", text: "rgb(37, 37, 37)" })
    report("theme-change", { before, after })
  })

  test("resolves light-dark() by the host's theme, and follows a theme change", async ({
    page,
  }) => {
    await startFake(page, {
      context: {
        theme: "light",
        styles: {
          variables: {
            "--color-background-primary":
              "light-dark(rgb(250, 250, 250), rgb(20, 20, 20))",
          },
        },
      },
    })
    const light = await cardStyle(page, "backgroundColor")
    expect(light).toBe("rgb(250, 250, 250)")
    await page.evaluate(() => window.fakeHost.changeContext({ theme: "dark" }))
    await expect.poll(() => cardStyle(page, "backgroundColor")).toBe("rgb(20, 20, 20)")
    // nessa_ui's dark defaults apply where the host sends nothing.
    await expect.poll(() => cardStyle(page, "color")).toBe("rgb(250, 250, 250)")
    report("theme-mode", { light, dark: await cardStyle(page, "backgroundColor") })
  })

  // A custom property takes url(), so only the shell keeps it out here.
  test("ignores an unsafe value and keeps the default", async ({ page }) => {
    const { errors } = await startFake(page, {
      context: {
        styles: {
          variables: {
            "--color-background-primary": "url(https://evil.example/x.png)",
          },
        },
      },
    })
    expect(await cardStyle(page, "backgroundColor")).toBe("rgb(255, 255, 255)")
    expect(errors).toEqual([])
  })

  test("sizes the iframe to the app as the app reports it", async ({ page }) => {
    await startFake(page, { tool: weather })
    await expect
      .poll(() => page.evaluate(() => window.fakeHost.sizes.length))
      .toBeGreaterThan(0)
    const measured = await page.evaluate(() => {
      const last = window.fakeHost.sizes.at(-1)
      return {
        reported: last?.height ?? 0,
        iframe: window.iframe.getBoundingClientRect().height,
      }
    })
    expect(measured.reported).toBeGreaterThan(100)
    expect(measured.iframe).toBe(measured.reported)
    report("size", measured)
  })

  test("shows a refusal, and a granted call, as the host answers", async ({ page }) => {
    await startFake(page, {
      context: { availableDisplayModes: ["inline"] },
      tools: { refresh: { content: [], structuredContent: { temperature: 9 } } },
    })
    await app(page).getByRole("button", { name: "Refresh" }).click()
    await expect(field(page, "answer")).toContainText(
      'refresh: {"content":[],"structuredContent":{"temperature":9}}',
    )
    await app(page).getByRole("button", { name: "Fullscreen" }).click()
    await expect(field(page, "answer")).toHaveText(
      "fullscreen: refused: display-mode-unavailable",
    )
    await app(page).getByRole("button", { name: "Ask" }).click()
    await expect(field(page, "answer")).toHaveText('message: "ok"')
    expect(await page.evaluate(() => window.fakeHost.messages.length)).toBe(1)
  })

  test("goes fullscreen when the host offers it", async ({ page }) => {
    await startFake(page, {
      context: { availableDisplayModes: ["inline", "fullscreen"] },
    })
    await app(page).getByRole("button", { name: "Fullscreen" }).click()
    await expect(field(page, "answer")).toHaveText('fullscreen: "fullscreen"')
    await expect(field(page, "mode")).toHaveText("fullscreen")
  })

  test("is torn down with the host's reason", async ({ page }) => {
    await startFake(page, {})
    const answer = await page.evaluate(() =>
      window.fakeHost.teardown("the person closed it"),
    )
    expect(answer).toEqual({ ok: true })
    await expect(field(page, "teardown")).toHaveText("the person closed it")
    await expect(field(page, "status")).toHaveText("torn-down")
  })
})

test.describe("in the reference SDK's host (AppBridge)", () => {
  test("connects, takes the host's theme, follows a change, and calls through", async ({
    page,
  }) => {
    const errors = await serve(page)
    await page.goto(`${origin}/hosts/reference.html`)
    await page.evaluate(() => window.startReferenceHost())
    await expect(field(page, "status")).toHaveText("connected")
    expect(await cardStyle(page, "backgroundColor")).toBe("rgb(240, 248, 255)")

    await page.evaluate(async () => {
      await window.referenceBridge.sendToolInput({ arguments: { city: "Lima" } })
      await window.referenceBridge.sendHostContextChange({ theme: "dark" })
    })
    await expect(field(page, "city")).toHaveText("Lima")
    // A theme-only change keeps the host's variables and switches the defaults.
    await expect.poll(() => cardStyle(page, "color")).toBe("rgb(250, 250, 250)")
    expect(await cardStyle(page, "backgroundColor")).toBe("rgb(240, 248, 255)")

    await app(page).getByRole("button", { name: "Refresh" }).click()
    await expect(field(page, "answer")).toContainText('"temperature":4')
    expect(await page.evaluate(() => window.calls)).toEqual([
      { name: "refresh", arguments: { city: "Oslo" } },
    ])
    expect(errors).toEqual([])
    report("reference-host", { consoleErrors: errors.length })
  })
})
