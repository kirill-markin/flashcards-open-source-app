const { realpathSync, writeSync } = require("node:fs");
const manifest = require("/opt/nibomo-node/manifest.json");
if (process.version !== manifest.version || process.arch !== manifest.arch
    || realpathSync(process.execPath) !== `/tmp/nibomo-node-${manifest.sha256}/node`
    || !/^[a-f0-9]{64}$/.test(process.env.NIBOMO_NODE_RUNTIME_ID ?? "")) {
  throw new Error("Patched Node startup verification failed; refusing to load the Lambda handler");
}
// Write before the RIC installs console hooks; Lambda still applies the configured JSON log level.
writeSync(1, `${JSON.stringify({
  timestamp: new Date().toISOString(), level: "INFO", event: "nibomo_node_runtime",
  version: process.version, arch: process.arch, sha256: manifest.sha256,
  runtimeId: process.env.NIBOMO_NODE_RUNTIME_ID, functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
})}\n`);
