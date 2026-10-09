/** Types for the reference host. The package is not a dependency of this extension; the capture script aliases the real module when it builds the page. */
declare module "@modelcontextprotocol/ext-apps/app-bridge" {
  export class PostMessageTransport {
    constructor(target: Window, source: Window)
  }

  export class AppBridge {
    constructor(
      client: null,
      info: { name: string; version: string },
      capabilities: {
        serverTools: Record<string, never>
        openLinks?: Record<string, never>
      },
      options: { hostContext: Record<string, unknown> },
    )
    oncalltool: (params: {
      name: string
      arguments?: Record<string, unknown>
    }) => Promise<unknown>
    onrequestdisplaymode: (params: { mode: string }) => Promise<{ mode: string }>
    onsizechange: (params: { height?: number }) => void
    oninitialized: () => void
    setHostContext(context: Record<string, unknown>): void
    connect(transport: PostMessageTransport): Promise<void>
    sendToolInput(input: { arguments: Record<string, unknown> }): Promise<void>
    sendToolResult(result: {
      content: readonly { type: "text"; text: string }[]
      structuredContent: Record<string, unknown>
    }): Promise<void>
  }
}

declare module "*.html?raw" {
  const html: string
  export default html
}
