/**
 * Sample experiments, as a source hands them to `validateExperiment`: the
 * checkout-support hill-climb, a latency experiment of another kind, and one
 * at scale. Each is dated from the `startedAt` it is given and reads the same
 * every time. Kept apart from the model's barrel, which exports nothing
 * sample-shaped (`samples.test.ts`, "are not exported from the model").
 */
export { checkoutExperimentId, checkoutSample } from "./checkout.ts"
export { latencyExperimentId, latencySample } from "./latency.ts"
export { scaleCases, scaleExperimentId, scaleFiles, scaleSample } from "./scale.ts"
