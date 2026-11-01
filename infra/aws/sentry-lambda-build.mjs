import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(new URL("./package.json", import.meta.url));
const { sentryOrchestrionPlugin } = require("@sentry/server-utils/orchestrion/esbuild");
// The transformer warns and returns uninstrumented source on failure; fail CI instead.
console.warn = (...messages) => { throw new Error(messages.map(String).join(" ")); };
const esbuild = require(process.argv[3]);
const options = JSON.parse(process.argv[2]);
const result = await esbuild.build({
  ...options,
  bundle: true,
  metafile: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  // Orchestrion prepends its marker on this unmapped line, preserving map columns.
  banner: { js: "// Sentry instrumentation" },
  logLevel: "warning",
  plugins: [sentryOrchestrionPlugin()],
});
if (result.metafile === undefined) throw new Error("Missing instrumented Lambda input graph");
process.stdout.write(JSON.stringify({
  inputs: Object.keys(result.metafile.inputs).map((file) => resolve(options.absWorkingDir, file)),
  buildInputs: Object.keys(require.cache),
}));
