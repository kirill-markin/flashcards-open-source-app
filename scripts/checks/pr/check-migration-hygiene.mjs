import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const MIGRATIONS_DIR = "db/migrations";
const DEFAULT_BASE_REF = "main";

// Only numbered SQL migrations are governed here. Companion files such as
// db/migrations/README.md are never applied by scripts/deploy/migrate.sh and
// stay editable.
const APPLIED_MIGRATION_PATH_PATTERN = /^db\/migrations\/\d{4}_[^/]*\.sql$/;
const ADDED_MIGRATION_PATH_PATTERN = /^db\/migrations\/[^/]+\.sql$/;
const MIGRATION_FILE_NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const SCHEMA_HEADER_PATTERN = /^-- Schemas touched\/read explicitly: .+$/m;
const SCHEMA_HEADER_SHAPE = "-- Schemas touched/read explicitly: <schema>, <schema>, ...";
const SCHEMA_HEADER_EXAMPLE_FILE = "db/migrations/0104_generated_image_placeholder_terminal_state.sql";
const SCHEMA_HEADER_EXAMPLE_LINE = "-- Schemas touched/read explicitly: content, org, sync, pg_catalog.";

const IMMUTABILITY_REASON =
  "scripts/deploy/migrate.sh records every applied migration by filename in the schema_migrations "
  + "table and skips any filename already present, so modifying, deleting or renaming a migration "
  + "that already ran is a silent no-op in production.";
const IMMUTABILITY_FIX =
  "Revert this file to its base-branch content and express the change as a new higher-numbered migration.";

function exitWithGitFailure(details) {
  console.error("Migration hygiene check could not inspect git history.", details);
  process.exit(1);
}

function spawnGit(gitArguments) {
  const gitProcess = spawnSync("git", gitArguments, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });

  if (gitProcess.error !== undefined) {
    exitWithGitFailure({
      command: `git ${gitArguments.join(" ")}`,
      repoRoot: REPO_ROOT,
      errorMessage: gitProcess.error.message,
    });
  }

  if (gitProcess.signal !== null) {
    exitWithGitFailure({
      command: `git ${gitArguments.join(" ")}`,
      repoRoot: REPO_ROOT,
      signal: gitProcess.signal,
    });
  }

  return gitProcess;
}

function runGit(gitArguments) {
  const gitProcess = spawnGit(gitArguments);

  if (gitProcess.status !== 0) {
    exitWithGitFailure({
      command: `git ${gitArguments.join(" ")}`,
      repoRoot: REPO_ROOT,
      exitCode: gitProcess.status,
      stderr: gitProcess.stderr.trim(),
    });
  }

  return gitProcess.stdout;
}

function commitRefExists(ref) {
  return spawnGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0;
}

function resolveBaseCommit() {
  const requestedBaseRef = (process.env.PR_BASE_REF ?? "").trim();
  const baseRef = requestedBaseRef === "" ? DEFAULT_BASE_REF : requestedBaseRef;
  const remoteBaseRef = `origin/${baseRef}`;

  let resolvedBaseRef = null;
  if (commitRefExists(remoteBaseRef)) {
    resolvedBaseRef = remoteBaseRef;
  } else if (commitRefExists(baseRef)) {
    resolvedBaseRef = baseRef;
  }

  if (resolvedBaseRef === null) {
    console.error("Migration hygiene check could not resolve the pull request base ref.", {
      requestedBaseRef: requestedBaseRef === "" ? null : requestedBaseRef,
      baseRef,
      triedRefs: [remoteBaseRef, baseRef],
      repoRoot: REPO_ROOT,
    });
    process.exit(1);
  }

  return {
    baseRef,
    resolvedBaseRef,
    baseCommit: runGit(["merge-base", resolvedBaseRef, "HEAD"]).trim(),
  };
}

function parseNameStatusRecords(diffOutput) {
  const fields = diffOutput.split("\0").filter((field) => field !== "");
  const records = [];
  let fieldIndex = 0;

  while (fieldIndex < fields.length) {
    const status = fields[fieldIndex];
    const statusLetter = status[0];
    const pathCount = statusLetter === "R" || statusLetter === "C" ? 2 : 1;

    if (fields.length - fieldIndex - 1 < pathCount) {
      console.error("Migration hygiene check could not parse the git diff output.", {
        status,
        expectedPathCount: pathCount,
        remainingFields: fields.slice(fieldIndex + 1),
      });
      process.exit(1);
    }

    records.push({
      status,
      sourcePath: pathCount === 2 ? fields[fieldIndex + 1] : null,
      destinationPath: pathCount === 2 ? fields[fieldIndex + 2] : fields[fieldIndex + 1],
    });
    fieldIndex += pathCount + 1;
  }

  return records;
}

function formatPrefix(prefixNumber) {
  return String(prefixNumber).padStart(4, "0");
}

function readHighestBasePrefix(baseCommit) {
  const basePrefixes = runGit(["ls-tree", "--name-only", baseCommit, `${MIGRATIONS_DIR}/`])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => APPLIED_MIGRATION_PATH_PATTERN.test(line))
    .map((line) => Number.parseInt(line.slice(MIGRATIONS_DIR.length + 1, MIGRATIONS_DIR.length + 5), 10));

  if (basePrefixes.length === 0) {
    console.error("Migration hygiene check found no numbered migrations at the base commit.", {
      baseCommit,
      migrationsDir: MIGRATIONS_DIR,
    });
    process.exit(1);
  }

  return Math.max(...basePrefixes);
}

function readAddedMigrationContent(migrationPath) {
  const absolutePath = join(REPO_ROOT, migrationPath);

  try {
    return readFileSync(absolutePath, "utf8");
  } catch (readError) {
    console.error("Migration hygiene check could not read an added migration from the working tree.", {
      migrationPath,
      absolutePath,
      errorMessage: readError.message,
    });
    process.exit(1);
  }
}

const { baseRef, resolvedBaseRef, baseCommit } = resolveBaseCommit();
const changedRecords = parseNameStatusRecords(
  runGit(["diff", "--name-status", "-z", baseCommit, "HEAD", "--", MIGRATIONS_DIR]),
);

const violations = [];
const addedMigrationPaths = [];

for (const record of changedRecords) {
  const statusLetter = record.status[0];

  if (statusLetter === "A") {
    if (ADDED_MIGRATION_PATH_PATTERN.test(record.destinationPath)) {
      addedMigrationPaths.push(record.destinationPath);
    }
    continue;
  }

  if (statusLetter === "M" || statusLetter === "T" || statusLetter === "D") {
    if (APPLIED_MIGRATION_PATH_PATTERN.test(record.destinationPath)) {
      violations.push({
        rule: "migration-immutability",
        file: record.destinationPath,
        gitStatus: record.status,
        reason: IMMUTABILITY_REASON,
        fix: IMMUTABILITY_FIX,
      });
    }
    continue;
  }

  if (statusLetter === "R" || statusLetter === "C") {
    if (statusLetter === "R" && APPLIED_MIGRATION_PATH_PATTERN.test(record.sourcePath)) {
      violations.push({
        rule: "migration-immutability",
        file: record.sourcePath,
        renamedTo: record.destinationPath,
        gitStatus: record.status,
        reason: IMMUTABILITY_REASON,
        fix: IMMUTABILITY_FIX,
      });
    }
    if (ADDED_MIGRATION_PATH_PATTERN.test(record.destinationPath)) {
      addedMigrationPaths.push(record.destinationPath);
    }
    continue;
  }

  console.error("Migration hygiene check received an unsupported git diff status.", {
    status: record.status,
    sourcePath: record.sourcePath,
    destinationPath: record.destinationPath,
  });
  process.exit(1);
}

const highestBasePrefix = readHighestBasePrefix(baseCommit);
const nextFreePrefix = formatPrefix(highestBasePrefix + 1);
const addedPathsByPrefix = new Map();

for (const migrationPath of addedMigrationPaths.sort()) {
  const fileName = migrationPath.slice(MIGRATIONS_DIR.length + 1);
  const nameMatch = MIGRATION_FILE_NAME_PATTERN.exec(fileName);

  if (nameMatch === null) {
    violations.push({
      rule: "migration-naming",
      file: migrationPath,
      reason: "A new migration file name must match 0000_lower_snake_case.sql.",
      fix: `Rename it to ${nextFreePrefix}_<lower_snake_case_name>.sql.`,
    });
  } else {
    const prefix = nameMatch[1];
    const prefixNumber = Number.parseInt(prefix, 10);

    if (prefixNumber <= highestBasePrefix) {
      violations.push({
        rule: "migration-numbering",
        file: migrationPath,
        prefix,
        highestPrefixOnBase: formatPrefix(highestBasePrefix),
        nextFreePrefix,
        reason:
          "A new migration must sort after every migration that already exists on the base branch, "
          + "because migrations are applied in file name order.",
        fix: `Rename it to ${nextFreePrefix}_<lower_snake_case_name>.sql.`,
      });
    }

    const pathsWithPrefix = addedPathsByPrefix.get(prefix) ?? [];
    addedPathsByPrefix.set(prefix, [...pathsWithPrefix, migrationPath]);
  }

  if (!SCHEMA_HEADER_PATTERN.test(readAddedMigrationContent(migrationPath))) {
    violations.push({
      rule: "migration-schema-header",
      file: migrationPath,
      expectedHeader: SCHEMA_HEADER_SHAPE,
      exampleFile: SCHEMA_HEADER_EXAMPLE_FILE,
      exampleHeader: SCHEMA_HEADER_EXAMPLE_LINE,
      reason:
        "CLAUDE.md requires 'Always mention the schema explicitly in migrations', so every new "
        + "migration must carry the schema header line.",
      fix: "Add the header line to the comment block at the top of the migration.",
    });
  }
}

for (const [prefix, pathsWithPrefix] of addedPathsByPrefix) {
  if (pathsWithPrefix.length > 1) {
    violations.push({
      rule: "migration-duplicate-prefix",
      prefix,
      files: pathsWithPrefix,
      nextFreePrefix,
      reason:
        "Two migrations added in this pull request share a four-digit prefix, which makes their "
        + "apply order depend on the rest of the file name.",
      fix: `Give each added migration its own prefix starting at ${nextFreePrefix}.`,
    });
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error("Migration hygiene violation.", violation);
  }

  console.error("Migration hygiene check failed.", {
    violationCount: violations.length,
    baseRef,
    resolvedBaseRef,
    baseCommit,
    migrationsDir: MIGRATIONS_DIR,
  });
  process.exit(1);
}

console.log("Migration hygiene check passed.", {
  baseRef,
  resolvedBaseRef,
  baseCommit,
  addedMigrations: addedMigrationPaths,
  highestPrefixOnBase: formatPrefix(highestBasePrefix),
});
