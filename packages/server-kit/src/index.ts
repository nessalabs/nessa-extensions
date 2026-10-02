/**
 * The server kit: what an extension's MCP server is built on. See this
 * package's README for the module map.
 *
 * - Defining an extension (`defineExtension`, `defineTool`): its views and
 *   tools, checked once.
 * - Its MCP server (`serverFactory`), which answers each request for the
 *   client that sent it: with views for a host that renders MCP Apps, as a
 *   plain MCP server otherwise.
 * - Serving it (`serveOverStdio`, `serveOverHttp`).
 */
export {
  DefinitionError,
  defineExtension,
  defineTool,
  type Caller,
  type Effects,
  type Extension,
  type ExtensionDefinition,
  type InputSchema,
  type Tool,
  type ToolCall,
  type ToolDefinition,
  type ToolOutcome,
  type ViewDefinition,
  type ViewUri,
} from "./definition.ts"
export { serverFactory } from "./server.ts"
export {
  serveOverHttp,
  serveOverStdio,
  type HttpOptions,
  type HttpServing,
} from "./transports.ts"
