import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = dirname(SCRIPT_DIR);
const SOURCE_ROOT = join(BACKEND_ROOT, "src");

function listTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return listTestFiles(entryPath);
      }

      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        return [relative(BACKEND_ROOT, entryPath)];
      }

      return [];
    });
}

const testFiles = listTestFiles(SOURCE_ROOT).sort();

if (testFiles.length === 0) {
  console.error("No backend test files found.", {
    sourceRoot: SOURCE_ROOT,
  });
  process.exit(1);
}

const testProcess = spawnSync(
  process.execPath,
  [
    "--test",
    "--import",
    "tsx",
    ...testFiles,
  ],
  {
    cwd: BACKEND_ROOT,
    stdio: "inherit",
    shell: false,
  },
);

if (testProcess.error !== undefined) {
  console.error("Backend test runner failed to start.", {
    backendRoot: BACKEND_ROOT,
    sourceRoot: SOURCE_ROOT,
    errorMessage: testProcess.error.message,
  });
  throw testProcess.error;
}

if (testProcess.signal !== null) {
  console.error("Backend test runner terminated by signal.", {
    backendRoot: BACKEND_ROOT,
    signal: testProcess.signal,
  });
  process.exit(1);
}

process.exit(testProcess.status ?? 1);
