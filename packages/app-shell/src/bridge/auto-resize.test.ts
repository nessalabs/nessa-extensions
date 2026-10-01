import { describe, expect, it } from "vitest"

import { createFakeHost } from "../fake-host/fake-host.ts"
import { memoryChannel } from "../protocol/memory-channel.ts"
import { autoResize, type ObserveSize } from "./auto-resize.ts"
import { createBridge } from "./bridge.ts"

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** An element whose size the test sets, and an observer the test fires. */
function fakeElement() {
  let rect = { width: 0, height: 0 }
  const element = { getBoundingClientRect: () => rect } as unknown as Element
  let changed: (() => void) | null = null
  let observing = 0
  const observe: ObserveSize = (_element, onChange) => {
    changed = onChange
    observing++
    return () => {
      changed = null
      observing--
    }
  }
  return {
    element,
    observe,
    resize(width: number, height: number) {
      rect = { width, height }
      changed?.()
    },
    observing: () => observing,
  }
}

async function setup() {
  const channel = memoryChannel()
  const host = createFakeHost({ transport: channel.host })
  const bridge = createBridge({
    transport: channel.app,
    app: { name: "a", version: "1" },
  })
  return { host, bridge }
}

describe("autoResize", () => {
  it("reports nothing until connected, then the size at once and each change, rounded up", async () => {
    const { host, bridge } = await setup()
    const fake = fakeElement()
    fake.resize(100.2, 40)
    autoResize(bridge, fake.element, fake.observe)
    expect(fake.observing()).toBe(0)
    await bridge.connect()
    await host.initialized
    expect(fake.observing()).toBe(1)
    fake.resize(100.2, 40)
    fake.resize(320, 240.5)
    await flush()
    expect(host.sizes).toEqual([
      { width: 101, height: 40 },
      { width: 320, height: 241 },
    ])
    // The first size goes after initialized, as the standard orders it.
    expect(host.violations).toEqual([])
  })

  it("stops when the host tears the app down", async () => {
    const { host, bridge } = await setup()
    const fake = fakeElement()
    autoResize(bridge, fake.element, fake.observe)
    await bridge.connect()
    await host.initialized
    await host.teardown()
    expect(fake.observing()).toBe(0)
  })

  it("stops when the app stops it", async () => {
    const { host, bridge } = await setup()
    const fake = fakeElement()
    const stop = autoResize(bridge, fake.element, fake.observe)
    await bridge.connect()
    await host.initialized
    stop()
    expect(fake.observing()).toBe(0)
    bridge.close()
    expect(fake.observing()).toBe(0)
  })
})
