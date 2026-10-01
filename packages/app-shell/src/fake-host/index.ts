/** A host that plays MCP Apps' message sequence, for tests, Storybook, and Playwright. */
export { appCsp, restrictiveCsp, type ResourceCsp } from "./csp.ts"
export {
  createFakeHost,
  FakeHostMisuse,
  HostRefusal,
  type AppViolation,
  type FakeHost,
  type FakeHostHandlers,
  type FakeHostOptions,
  type FakeHostStage,
  type FakeToolCall,
  type LoggedMessage,
} from "./fake-host.ts"
export { mountFakeHostFrame, withPolicy, type FakeHostFrameOptions } from "./frame.ts"
export { memoryChannel, type MemoryChannel } from "../protocol/memory-channel.ts"
