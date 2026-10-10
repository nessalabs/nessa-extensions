/**
 * The scenario runner completes a tool without naming it, so Nessa keeps the
 * text and drops the structured result. The completion below names the tool
 * the way the harness's own frames do (`mcp__<server>__<tool>`), and the
 * gateway then attaches the result it already forwarded.
 */
const needle = "ctx.update(completedUpdate(id, result))"
const named = `ctx.update({
    ...completedUpdate(id, result),
    _meta: { claudeCode: { toolName: \`mcp__\${SERVER}__\${step.tool}\` } },
  })`

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context)
  if (!url.endsWith("/scripted-scenario.mjs")) return loaded
  const source =
    typeof loaded.source === "string"
      ? loaded.source
      : Buffer.from(loaded.source).toString("utf8")
  if (!source.includes(needle)) {
    throw new Error(
      "the scenario runner no longer completes a tool the way this capture names it",
    )
  }
  return { ...loaded, source: source.replace(needle, named) }
}
