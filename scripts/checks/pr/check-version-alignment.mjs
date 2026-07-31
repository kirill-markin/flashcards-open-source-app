// Fails when the repo-owned release version surfaces do not all report the same
// semantic version, so a half-finished version bump is caught before merge.
// The surfaces and their alignment rules are defined in docs/version-bump.md.
// API contract values (`/v1` paths, OpenAPI `info.version`, API Gateway stage
// names) are deliberately not checked here: they do not move with a release.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const DOCUMENTATION_PATH = "docs/version-bump.md";

const SEMANTIC_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

const NODE_PACKAGE_DIRECTORIES = [
  "apps/backend",
  "apps/admin",
  "api",
  "apps/auth",
  "infra/aws",
  "apps/web",
];

const MCP_MANIFEST_FILE = "server.json";

const ANDROID_GRADLE_FILE = "apps/android/app/build.gradle.kts";
const ANDROID_VERSION_NAME_PATTERN = /^[^\S\r\n]*versionName[^\S\r\n]*=[^\S\r\n]*"([^"]*)"/m;

const IOS_XCCONFIG_FILE = "apps/ios/Flashcards/Config/Base.xcconfig";
const IOS_MARKETING_VERSION_PATTERN = /^APP_MARKETING_VERSION[^\S\r\n]*=[^\S\r\n]*(.*)$/m;

const LOCK_ROOT_PACKAGE_FIELD = 'packages[""].version';

function describeSurface(surface) {
  return `${surface.file} (${surface.field})`;
}

function readRepositoryFile(relativeFilePath) {
  const absoluteFilePath = join(REPO_ROOT, relativeFilePath);

  if (!existsSync(absoluteFilePath)) {
    console.error("Version surface file is missing.", {
      file: relativeFilePath,
      repoRoot: REPO_ROOT,
      documentation: DOCUMENTATION_PATH,
    });
    process.exit(1);
  }

  return readFileSync(absoluteFilePath, "utf8");
}

function parseJsonObject(relativeFilePath) {
  const fileContent = readRepositoryFile(relativeFilePath);

  let parsedJson;
  try {
    parsedJson = JSON.parse(fileContent);
  } catch (parseError) {
    console.error("Version surface file is not valid JSON.", {
      file: relativeFilePath,
      errorMessage: parseError.message,
      documentation: DOCUMENTATION_PATH,
    });
    process.exit(1);
  }

  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    console.error("Version surface JSON is not an object.", {
      file: relativeFilePath,
      documentation: DOCUMENTATION_PATH,
    });
    process.exit(1);
  }

  return parsedJson;
}

function readLockRootPackageVersion(lockJson, relativeFilePath) {
  const lockPackages = lockJson.packages;

  if (typeof lockPackages !== "object" || lockPackages === null || Array.isArray(lockPackages)) {
    console.error("Lockfile has no packages map.", {
      file: relativeFilePath,
      field: "packages",
      documentation: DOCUMENTATION_PATH,
    });
    process.exit(1);
  }

  const rootPackage = lockPackages[""];

  if (typeof rootPackage !== "object" || rootPackage === null || Array.isArray(rootPackage)) {
    console.error("Lockfile has no root package entry.", {
      file: relativeFilePath,
      field: LOCK_ROOT_PACKAGE_FIELD,
      documentation: DOCUMENTATION_PATH,
    });
    process.exit(1);
  }

  return rootPackage.version;
}

function readCapturedVersionLiteral(relativeFilePath, field, pattern) {
  const fileContent = readRepositoryFile(relativeFilePath);
  const match = fileContent.match(pattern);

  if (match === null) {
    console.error("Version literal not found in file.", {
      file: relativeFilePath,
      field,
      expectedPattern: pattern.source,
      documentation: DOCUMENTATION_PATH,
    });
    process.exit(1);
  }

  return match[1].trim();
}

function collectNodePackageSurfaces(packageDirectory) {
  const manifestFile = `${packageDirectory}/package.json`;
  const lockFile = `${packageDirectory}/package-lock.json`;
  const manifestJson = parseJsonObject(manifestFile);
  const lockJson = parseJsonObject(lockFile);

  return [
    { file: manifestFile, field: "version", value: manifestJson.version },
    { file: lockFile, field: "version", value: lockJson.version },
    {
      file: lockFile,
      field: LOCK_ROOT_PACKAGE_FIELD,
      value: readLockRootPackageVersion(lockJson, lockFile),
    },
  ];
}

const surfaces = [
  ...NODE_PACKAGE_DIRECTORIES.flatMap(collectNodePackageSurfaces),
  {
    file: MCP_MANIFEST_FILE,
    field: "version",
    value: parseJsonObject(MCP_MANIFEST_FILE).version,
  },
  {
    file: ANDROID_GRADLE_FILE,
    field: "versionName",
    value: readCapturedVersionLiteral(
      ANDROID_GRADLE_FILE,
      "versionName",
      ANDROID_VERSION_NAME_PATTERN,
    ),
  },
  {
    file: IOS_XCCONFIG_FILE,
    field: "APP_MARKETING_VERSION",
    value: readCapturedVersionLiteral(
      IOS_XCCONFIG_FILE,
      "APP_MARKETING_VERSION",
      IOS_MARKETING_VERSION_PATTERN,
    ),
  },
];

const invalidSurfaces = surfaces.filter(
  (surface) => typeof surface.value !== "string" || !SEMANTIC_VERSION_PATTERN.test(surface.value),
);

if (invalidSurfaces.length > 0) {
  console.error("Version surfaces are missing, blank, or not a semantic version.", {
    invalidSurfaceCount: invalidSurfaces.length,
    expectedPattern: SEMANTIC_VERSION_PATTERN.source,
    documentation: DOCUMENTATION_PATH,
  });

  for (const surface of invalidSurfaces) {
    console.error("Invalid version surface.", {
      surface: describeSurface(surface),
      value: surface.value,
    });
  }

  process.exit(1);
}

const surfacesByVersion = new Map();

for (const surface of surfaces) {
  const knownSurfaces = surfacesByVersion.get(surface.value);

  if (knownSurfaces === undefined) {
    surfacesByVersion.set(surface.value, [describeSurface(surface)]);
    continue;
  }

  knownSurfaces.push(describeSurface(surface));
}

const reportedVersions = [...surfacesByVersion.keys()].sort();

if (reportedVersions.length > 1) {
  console.error("Release version surfaces disagree.", {
    reportedVersions,
    surfaceCount: surfaces.length,
    documentation: DOCUMENTATION_PATH,
  });

  for (const reportedVersion of reportedVersions) {
    console.error("Surfaces reporting this version.", {
      version: reportedVersion,
      surfaces: surfacesByVersion.get(reportedVersion),
    });
  }

  process.exit(1);
}

console.log("All release version surfaces report the same version.", {
  version: reportedVersions[0],
  surfaceCount: surfaces.length,
});
