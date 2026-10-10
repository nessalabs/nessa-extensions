/**
 * Loaded before the scripted agent (`node --import`). Nessa attaches a
 * forwarded `structuredContent` only when the completion update names the
 * MCP tool. The scenario runner's completion does not, so the experiment
 * arrives as text and the app has nothing to draw. This registers the hook
 * that adds the tool name to that one update.
 */
import { register } from "node:module"

await register("./forward-structured-hook.mjs", import.meta.url)
