// Keeps the published agent API contract, the deployed-environment smoke script,
// and the agent discovery envelope describing the same set of routes.
//
// Without this check, adding, renaming, or removing a route only surfaces after
// deploy, when scripts/checks/check-agent-api-smoke.sh compares the live
// /v1/agent/openapi.json paths against its hand-maintained required_paths set
// and turns the release red.
//
// The spec path set is read from the top-level `paths:` mapping of
// api/src/openapi.yaml rather than from the redocly bundle. The static_checks
// job that runs this file installs no npm dependencies, and `redocly bundle`
// performs a network version check, so bundling here would be neither available
// nor offline. Bundling only inlines each `$ref`; it never adds, removes, or
// renames a top-level path key, so both sources yield the same path set.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");

const SPEC_FILE = join(REPO_ROOT, "api", "src", "openapi.yaml");
const SPEC_DIR = dirname(SPEC_FILE);
const SMOKE_FILE = join(REPO_ROOT, "scripts", "checks", "check-agent-api-smoke.sh");
const DISCOVERY_FILE = join(REPO_ROOT, "apps", "backend", "src", "agent", "discovery.ts");

const SPEC_PATHS_MARKER = "paths:";
const SPEC_PATH_KEY_PATTERN = /^ {2}(\S.*):$/;
const SPEC_PATH_REF_PATTERN = /^ {4}\$ref: (\S+)$/;

const SMOKE_REQUIRED_PATHS_MARKER = "required_paths = {";
const SMOKE_REQUIRED_PATH_PATTERN = /^"([^"]+)",$/;
const SMOKE_REQUIRED_PATHS_CLOSE = "}";

const DISCOVERY_SURFACE_MARKER = "surface: {";
const DISCOVERY_SURFACE_CLOSE_PATTERN = /^\},?$/;
const DISCOVERY_SURFACE_ENTRY_PATTERN = /^([A-Za-z][A-Za-z0-9]*): (.+),$/;
const DISCOVERY_SURFACE_SHORTHAND_PATTERN = /^([A-Za-z][A-Za-z0-9]*),$/;
const DISCOVERY_TEMPLATE_LITERAL_PATTERN = /^`(.*)`$/;
const API_BASE_URL_EXPRESSION = "${apiBaseUrl}";

function failCheck(message, details) {
  console.error(message, details);
  process.exit(1);
}

function readSourceFile(filePath) {
  if (!existsSync(filePath)) {
    failCheck("Contract drift check cannot read a required source file.", {
      filePath,
      repoRoot: REPO_ROOT,
    });
  }

  return readFileSync(filePath, "utf8");
}

function isMeaningfulLine(line) {
  const trimmedLine = line.trim();
  return trimmedLine !== "" && !trimmedLine.startsWith("#");
}

function findSoleLineIndex(lines, matchesLine, filePath, marker) {
  const matchedIndexes = [];

  lines.forEach((line, index) => {
    if (matchesLine(line)) {
      matchedIndexes.push(index);
    }
  });

  if (matchedIndexes.length !== 1) {
    failCheck("Contract drift check could not locate its anchor marker exactly once.", {
      filePath,
      marker,
      matchCount: matchedIndexes.length,
      matchedLineNumbers: matchedIndexes.map((index) => index + 1),
    });
  }

  return matchedIndexes[0];
}

// Top-level path keys of api/src/openapi.yaml, in declaration order.
function readSpecPathTemplates(specText) {
  const lines = specText.split("\n");
  const pathsLineIndex = findSoleLineIndex(
    lines,
    (line) => line === SPEC_PATHS_MARKER,
    SPEC_FILE,
    SPEC_PATHS_MARKER,
  );

  const pathTemplates = [];
  let cursor = pathsLineIndex + 1;

  while (cursor < lines.length) {
    if (!isMeaningfulLine(lines[cursor])) {
      cursor += 1;
      continue;
    }

    // A line starting at column zero ends the `paths:` block.
    if (/^\S/.test(lines[cursor])) {
      break;
    }

    const keyMatch = SPEC_PATH_KEY_PATTERN.exec(lines[cursor]);
    if (keyMatch === null) {
      failCheck("Unrecognized line inside the OpenAPI `paths:` block.", {
        filePath: SPEC_FILE,
        lineNumber: cursor + 1,
        line: lines[cursor],
        expectedShape: '  /some/path:',
      });
    }

    const pathTemplate = keyMatch[1].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!pathTemplate.startsWith("/")) {
      failCheck("OpenAPI path key does not start with a slash.", {
        filePath: SPEC_FILE,
        lineNumber: cursor + 1,
        pathTemplate,
      });
    }

    if (pathTemplates.includes(pathTemplate)) {
      failCheck("OpenAPI path key is declared more than once.", {
        filePath: SPEC_FILE,
        lineNumber: cursor + 1,
        pathTemplate,
      });
    }

    const refLineIndex = cursor + 1;
    const refMatch = refLineIndex < lines.length
      ? SPEC_PATH_REF_PATTERN.exec(lines[refLineIndex])
      : null;
    if (refMatch === null) {
      failCheck("OpenAPI path key is not followed by a single `$ref` line.", {
        filePath: SPEC_FILE,
        pathTemplate,
        lineNumber: refLineIndex + 1,
        line: refLineIndex < lines.length ? lines[refLineIndex] : "<end of file>",
        expectedShape: "    $ref: paths/some_path.yaml",
      });
    }

    const referencedFile = resolve(SPEC_DIR, refMatch[1]);
    if (!existsSync(referencedFile)) {
      failCheck("OpenAPI path `$ref` points at a file that does not exist.", {
        filePath: SPEC_FILE,
        pathTemplate,
        lineNumber: refLineIndex + 1,
        referencedFile,
      });
    }

    pathTemplates.push(pathTemplate);
    cursor = refLineIndex + 1;
  }

  if (pathTemplates.length === 0) {
    failCheck("OpenAPI `paths:` block declares no paths.", {
      filePath: SPEC_FILE,
      markerLineNumber: pathsLineIndex + 1,
    });
  }

  return pathTemplates;
}

// String literals of the inline `required_paths` set in the smoke script.
function readSmokeRequiredPaths(smokeText) {
  const lines = smokeText.split("\n");
  const markerLineIndex = findSoleLineIndex(
    lines,
    (line) => line.trim() === SMOKE_REQUIRED_PATHS_MARKER,
    SMOKE_FILE,
    SMOKE_REQUIRED_PATHS_MARKER,
  );

  const requiredPaths = [];

  for (let cursor = markerLineIndex + 1; cursor < lines.length; cursor += 1) {
    const trimmedLine = lines[cursor].trim();

    if (trimmedLine === SMOKE_REQUIRED_PATHS_CLOSE) {
      if (requiredPaths.length === 0) {
        failCheck("The smoke script `required_paths` set is empty.", {
          filePath: SMOKE_FILE,
          markerLineNumber: markerLineIndex + 1,
        });
      }

      return requiredPaths;
    }

    const entryMatch = SMOKE_REQUIRED_PATH_PATTERN.exec(trimmedLine);
    if (entryMatch === null) {
      failCheck("Unrecognized line inside the smoke script `required_paths` set.", {
        filePath: SMOKE_FILE,
        lineNumber: cursor + 1,
        line: lines[cursor],
        expectedShape: '    "/some/path",',
      });
    }

    if (requiredPaths.includes(entryMatch[1])) {
      failCheck("The smoke script `required_paths` set lists a path twice.", {
        filePath: SMOKE_FILE,
        lineNumber: cursor + 1,
        pathTemplate: entryMatch[1],
      });
    }

    requiredPaths.push(entryMatch[1]);
  }

  failCheck("The smoke script `required_paths` set is never closed.", {
    filePath: SMOKE_FILE,
    markerLineNumber: markerLineIndex + 1,
    expectedShape: "}",
  });
}

function readDiscoveryConstantTemplate(discoveryText, fieldName) {
  const declarationPattern = new RegExp(`^\\s*const ${fieldName} = \`([^\`]*)\`;$`, "gm");
  const declarations = [...discoveryText.matchAll(declarationPattern)];

  if (declarations.length !== 1) {
    failCheck("Agent discovery surface field could not be resolved to one template literal.", {
      filePath: DISCOVERY_FILE,
      fieldName,
      declarationCount: declarations.length,
      expectedShape: "const <fieldName> = `${apiBaseUrl}/some/path`;",
    });
  }

  return declarations[0][1];
}

// URL templates assigned to the `surface` object of the discovery envelope,
// resolved to spec-style paths.
function readDiscoverySurfacePaths(discoveryText) {
  const lines = discoveryText.split("\n");
  const markerLineIndex = findSoleLineIndex(
    lines,
    (line) => line.trim() === DISCOVERY_SURFACE_MARKER,
    DISCOVERY_FILE,
    DISCOVERY_SURFACE_MARKER,
  );

  const surfacePaths = [];

  for (let cursor = markerLineIndex + 1; cursor < lines.length; cursor += 1) {
    const trimmedLine = lines[cursor].trim();

    if (DISCOVERY_SURFACE_CLOSE_PATTERN.test(trimmedLine)) {
      if (surfacePaths.length === 0) {
        failCheck("The agent discovery `surface` object declares no fields.", {
          filePath: DISCOVERY_FILE,
          markerLineNumber: markerLineIndex + 1,
        });
      }

      return surfacePaths;
    }

    const shorthandMatch = DISCOVERY_SURFACE_SHORTHAND_PATTERN.exec(trimmedLine);
    const entryMatch = DISCOVERY_SURFACE_ENTRY_PATTERN.exec(trimmedLine);

    let fieldName = "";
    let rawTemplate = "";

    if (shorthandMatch !== null) {
      fieldName = shorthandMatch[1];
      rawTemplate = readDiscoveryConstantTemplate(discoveryText, fieldName);
    } else if (entryMatch !== null) {
      fieldName = entryMatch[1];
      const literalMatch = DISCOVERY_TEMPLATE_LITERAL_PATTERN.exec(entryMatch[2]);
      if (literalMatch === null) {
        failCheck("Agent discovery surface field is not a template literal.", {
          filePath: DISCOVERY_FILE,
          lineNumber: cursor + 1,
          fieldName,
          rawValue: entryMatch[2],
          expectedShape: "fieldName: `${apiBaseUrl}/some/path`,",
        });
      }
      rawTemplate = literalMatch[1];
    } else {
      failCheck("Unrecognized line inside the agent discovery `surface` object.", {
        filePath: DISCOVERY_FILE,
        lineNumber: cursor + 1,
        line: lines[cursor],
        expectedShape: "fieldName: `${apiBaseUrl}/some/path`, or fieldName,",
      });
    }

    if (!rawTemplate.startsWith(API_BASE_URL_EXPRESSION)) {
      failCheck("Agent discovery surface URL does not start with the API base URL expression.", {
        filePath: DISCOVERY_FILE,
        fieldName,
        rawTemplate,
        expectedPrefix: API_BASE_URL_EXPRESSION,
      });
    }

    const pathTemplate = rawTemplate.slice(API_BASE_URL_EXPRESSION.length);
    if (pathTemplate.includes("${")) {
      failCheck("Agent discovery surface URL contains an unresolvable interpolation.", {
        filePath: DISCOVERY_FILE,
        fieldName,
        rawTemplate,
        pathTemplate,
      });
    }

    if (!pathTemplate.startsWith("/")) {
      failCheck("Agent discovery surface URL does not resolve to an absolute path.", {
        filePath: DISCOVERY_FILE,
        fieldName,
        rawTemplate,
        pathTemplate,
      });
    }

    surfacePaths.push({ fieldName, rawTemplate, pathTemplate });
  }

  failCheck("The agent discovery `surface` object is never closed.", {
    filePath: DISCOVERY_FILE,
    markerLineNumber: markerLineIndex + 1,
  });
}

const specPathTemplates = readSpecPathTemplates(readSourceFile(SPEC_FILE));
const smokeRequiredPaths = readSmokeRequiredPaths(readSourceFile(SMOKE_FILE));
const discoverySurfacePaths = readDiscoverySurfacePaths(readSourceFile(DISCOVERY_FILE));

const specPathSet = new Set(specPathTemplates);
const smokeRequiredPathSet = new Set(smokeRequiredPaths);

const missingFromSmokeScript = specPathTemplates
  .filter((pathTemplate) => !smokeRequiredPathSet.has(pathTemplate))
  .sort();
const unexpectedInSmokeScript = smokeRequiredPaths
  .filter((pathTemplate) => !specPathSet.has(pathTemplate))
  .sort();
const undeclaredSurfacePaths = discoverySurfacePaths
  .filter((surfacePath) => !specPathSet.has(surfacePath.pathTemplate));

let hasFailure = false;

if (missingFromSmokeScript.length > 0 || unexpectedInSmokeScript.length > 0) {
  hasFailure = true;
  console.error(
    [
      "",
      "Agent API smoke contract is out of sync with the published OpenAPI spec.",
      "",
      `  spec:  ${SPEC_FILE}`,
      `  smoke: ${SMOKE_FILE}`,
      "",
      "Paths declared in the spec but missing from the smoke script `required_paths` set",
      "(the deployed smoke run will fail with missing_paths):",
      ...(missingFromSmokeScript.length > 0
        ? missingFromSmokeScript.map((pathTemplate) => `  + ${pathTemplate}`)
        : ["  (none)"]),
      "",
      "Paths listed in the smoke script `required_paths` set but absent from the spec",
      "(the deployed smoke run will fail with unexpected_paths):",
      ...(unexpectedInSmokeScript.length > 0
        ? unexpectedInSmokeScript.map((pathTemplate) => `  - ${pathTemplate}`)
        : ["  (none)"]),
      "",
      "Fix: edit the `required_paths` set in scripts/checks/check-agent-api-smoke.sh in the",
      "same change as the route change, so the smoke script asserts exactly the paths the",
      "spec publishes. Keep the agent discovery envelope in",
      "apps/backend/src/agent/discovery.ts and the API Gateway wiring in",
      "infra/aws/lib/gateways/api-gateway.ts aligned in that same change.",
      "",
    ].join("\n"),
  );
}

if (undeclaredSurfacePaths.length > 0) {
  hasFailure = true;
  console.error(
    [
      "",
      "Agent discovery surface points at routes the published OpenAPI spec does not declare.",
      "",
      `  discovery: ${DISCOVERY_FILE}`,
      `  spec:      ${SPEC_FILE}`,
      "",
      ...undeclaredSurfacePaths.flatMap((surfacePath) => [
        `  surface.${surfacePath.fieldName}`,
        `    literal:  ${surfacePath.rawTemplate}`,
        `    resolves: ${surfacePath.pathTemplate}`,
      ]),
      "",
      "Fix: either publish the route in api/src/openapi.yaml or correct the surface URL in",
      "apps/backend/src/agent/discovery.ts. An agent that follows a surface URL missing from",
      "the spec has no documented request or response contract to work from.",
      "",
    ].join("\n"),
  );
}

if (hasFailure) {
  process.exit(1);
}

console.log(
  "OpenAPI contract is in sync.",
  {
    specPaths: specPathTemplates.length,
    smokeRequiredPaths: smokeRequiredPaths.length,
    discoverySurfaceUrls: discoverySurfacePaths.length,
  },
);
