import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const CHECK_FILE_PATTERN = /^check-.*\.mjs$/;

const checkFileNames = readdirSync(SCRIPT_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && CHECK_FILE_PATTERN.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (checkFileNames.length === 0) {
  console.log("No pre-merge checks are registered in scripts/checks/pr yet.");
  process.exit(0);
}

const failedCheckNames = [];

for (const checkFileName of checkFileNames) {
  console.log(`[pr-checks] running ${checkFileName}`);

  const checkProcess = spawnSync(process.execPath, [join(SCRIPT_DIR, checkFileName)], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: false,
  });

  if (checkProcess.error !== undefined) {
    console.error("Pre-merge check failed to start.", {
      checkFileName,
      repoRoot: REPO_ROOT,
      errorMessage: checkProcess.error.message,
    });
    throw checkProcess.error;
  }

  if (checkProcess.signal !== null) {
    console.error("Pre-merge check terminated by signal.", {
      checkFileName,
      signal: checkProcess.signal,
    });
    failedCheckNames.push(checkFileName);
    continue;
  }

  if (checkProcess.status !== 0) {
    failedCheckNames.push(checkFileName);
  }
}

if (failedCheckNames.length > 0) {
  console.error("Pre-merge checks failed.", {
    failedChecks: failedCheckNames,
    totalChecks: checkFileNames.length,
  });
  process.exit(1);
}

console.log(`All ${checkFileNames.length} pre-merge checks passed.`);
