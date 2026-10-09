/**
 * Zod's fast path probes `new Function`. A strict CSP reports that call even
 * though the throw is caught, and the host shows it as a connection this app
 * did not declare. `jitless` skips the probe. This module is imported before
 * any schema is built, which is when the probe would run.
 */
import { config } from "zod/v4"

config({ jitless: true })
