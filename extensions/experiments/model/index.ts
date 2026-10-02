/**
 * The experiments model: the definition, the experiment, validation into a
 * branded `Experiment`, the one formatter, and what the views read. Pure:
 * no DOM, no Node, no clock. The zod schemas stay inside it; what the shape
 * is, is read from the types. See the extension's README for the module map.
 */
export type {
  ExperimentDefinition,
  Guardrail,
  Limit,
  Metric,
  Outcome,
  Split,
  Verdict,
} from "./definition.ts"
export {
  movedPageSize,
  type Activity,
  type Agent,
  type Area,
  type Baseline,
  type Cases,
  type ChangedFile,
  type Experiment,
  type ExperimentData,
  type ExperimentInput,
  type MovedCase,
  type Note,
  type Progress,
  type Run,
  type RunChange,
  type Score,
  type Slice,
  measureOf,
  movedCount,
  scoreOf,
} from "./experiment.ts"
export {
  formatSize,
  formatValue,
  type Change,
  type ChangeTone,
  type Formatted,
} from "./metric.ts"
export * from "./selections.ts"
export {
  rules,
  validateExperiment,
  type Path,
  type Problem,
  type Rule,
  type Validation,
} from "./validation.ts"
export { isId, type Tone } from "./values.ts"
