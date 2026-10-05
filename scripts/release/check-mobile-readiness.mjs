import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkReadiness, parseManifest } from "./mobile-readiness.ts";

function main() {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/release/check-mobile-readiness.mjs /path/to/manifest.json");
    process.exitCode = 2;
    return;
  }
  let input;
  try {
    input = readFileSync(process.argv[2], "utf8");
  } catch {
    console.error("Could not read manifest file. Verify the path and read permissions.");
    process.exitCode = 2;
    return;
  }
  let raw;
  try {
    raw = JSON.parse(input);
  } catch {
    console.error("Manifest is not valid JSON. Contents are omitted to protect private evidence.");
    process.exitCode = 2;
    return;
  }
  let manifest;
  try {
    manifest = parseManifest(raw);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  const report = {
    ...checkReadiness(manifest),
    manifestSha256: createHash("sha256").update(input).digest("hex"),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ready ? 0 : 1;
}

main();
