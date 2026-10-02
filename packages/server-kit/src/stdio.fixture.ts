/**
 * The sample extension served over this process's stdio, as `npx
 * @nessalabs/<name>` would serve one: `transports.test.ts` runs it as a child
 * process.
 */
import { sample } from "./testing.ts"
import { serveOverStdio } from "./transports.ts"

serveOverStdio(sample, { onerror: (error) => console.error(error) })
