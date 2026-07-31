import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const IOS_ROOT = join(REPO_ROOT, "apps", "ios");
const PROJECT_FILE = join(
  IOS_ROOT,
  "Flashcards",
  "Flashcards Open Source App.xcodeproj",
  "project.pbxproj",
);

// en is DEVELOPMENT_LANGUAGE in apps/ios/Flashcards/Config/Base.xcconfig, so an en variant is
// optional everywhere and never required by this check. Base is an Xcode pseudo-region, not a locale.
const REQUIRED_LOCALES = ["ar", "de", "es-ES", "es-MX", "hi", "ja", "ru", "zh-Hans"];
const UNTRANSLATED_PROJECT_REGIONS = new Set(["en", "Base"]);
const TRANSLATED_STATE = "translated";
const LPROJ_SUFFIX = ".lproj";
const IGNORED_DIRECTORY_NAMES = new Set(["DerivedData", "build", ".build", ".git"]);

const WHITESPACE_PATTERN = /\s+/y;
const LINE_COMMENT_PATTERN = /\/\/[^\n]*/y;
const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//y;
const STRINGS_ENTRY_PATTERN = /"((?:[^"\\]|\\[\s\S])*)"\s*=\s*"(?:[^"\\]|\\[\s\S])*"\s*;/y;
const KNOWN_REGIONS_PATTERN = /knownRegions\s*=\s*\(([^)]*)\);/g;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function listLocalizationFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        return [];
      }

      return listLocalizationFiles(entryPath);
    }

    if (entry.isFile() && (entry.name.endsWith(".strings") || entry.name.endsWith(".xcstrings"))) {
      return [entryPath];
    }

    return [];
  });
}

function lineNumberAt(content, index) {
  let lineNumber = 1;

  for (let position = 0; position < index; position += 1) {
    if (content[position] === "\n") {
      lineNumber += 1;
    }
  }

  return lineNumber;
}

function skipWhitespaceAndComments(content, startIndex) {
  let index = startIndex;
  let previousIndex = -1;

  while (index !== previousIndex) {
    previousIndex = index;

    for (const pattern of [WHITESPACE_PATTERN, LINE_COMMENT_PATTERN, BLOCK_COMMENT_PATTERN]) {
      pattern.lastIndex = index;

      if (pattern.exec(content) !== null) {
        index = pattern.lastIndex;
      }
    }
  }

  return index;
}

function parseStringsKeys(filePath) {
  const content = readFileSync(filePath, "utf8");
  const keys = new Set();
  let index = 0;

  while (index < content.length) {
    index = skipWhitespaceAndComments(content, index);

    if (index >= content.length) {
      break;
    }

    STRINGS_ENTRY_PATTERN.lastIndex = index;
    const entryMatch = STRINGS_ENTRY_PATTERN.exec(content);

    if (entryMatch === null) {
      return {
        keys: null,
        violation: {
          rule: "unparsable-strings-file",
          file: relative(REPO_ROOT, filePath),
          line: lineNumberAt(content, index),
          snippet: content.slice(index, index + 80),
          expectedSyntax: '"key" = "value";',
        },
      };
    }

    keys.add(entryMatch[1]);
    index = STRINGS_ENTRY_PATTERN.lastIndex;
  }

  return { keys, violation: null };
}

function parseStringCatalog(filePath) {
  const file = relative(REPO_ROOT, filePath);
  const content = readFileSync(filePath, "utf8");
  let catalog = null;

  try {
    catalog = JSON.parse(content);
  } catch (parseError) {
    return {
      catalogStrings: null,
      violation: { rule: "unparsable-catalog", file, errorMessage: parseError.message },
    };
  }

  if (!isPlainObject(catalog)) {
    return {
      catalogStrings: null,
      violation: { rule: "unparsable-catalog", file, errorMessage: "root value is not a JSON object" },
    };
  }

  if (!isPlainObject(catalog.strings)) {
    return {
      catalogStrings: null,
      violation: {
        rule: "unparsable-catalog",
        file,
        errorMessage: 'root object has no "strings" object',
      },
    };
  }

  return { catalogStrings: catalog.strings, violation: null };
}

function unquotePbxprojValue(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
}

// REQUIRED_LOCALES must stay identical to the Xcode project knownRegions, otherwise a language
// added in Xcode would never be compared here and would ship untranslated.
function findKnownRegionsViolations() {
  const file = relative(REPO_ROOT, PROJECT_FILE);

  if (!existsSync(PROJECT_FILE)) {
    return [{ rule: "missing-xcode-project", file }];
  }

  const knownRegionsMatches = [...readFileSync(PROJECT_FILE, "utf8").matchAll(KNOWN_REGIONS_PATTERN)];

  if (knownRegionsMatches.length !== 1) {
    return [
      {
        rule: "unreadable-known-regions",
        file,
        knownRegionsBlocks: knownRegionsMatches.length,
        expectedBlocks: 1,
      },
    ];
  }

  const projectLocales = knownRegionsMatches[0][1]
    .split(",")
    .map((region) => unquotePbxprojValue(region.trim()))
    .filter((region) => region.length > 0 && !UNTRANSLATED_PROJECT_REGIONS.has(region));
  const projectLocaleSet = new Set(projectLocales);
  const requiredLocaleSet = new Set(REQUIRED_LOCALES);
  const missingFromRequiredLocales = projectLocales.filter((locale) => !requiredLocaleSet.has(locale));
  const missingFromProjectRegions = REQUIRED_LOCALES.filter((locale) => !projectLocaleSet.has(locale));

  if (missingFromRequiredLocales.length === 0 && missingFromProjectRegions.length === 0) {
    return [];
  }

  return [
    {
      rule: "known-regions-drift",
      file,
      checkFile: relative(REPO_ROOT, fileURLToPath(import.meta.url)),
      requiredLocales: REQUIRED_LOCALES,
      projectLocales,
      missingFromRequiredLocales,
      missingFromProjectRegions,
    },
  ];
}

function groupStringsFilesByLprojParent(stringsFilePaths) {
  const groups = new Map();
  const violations = [];

  for (const stringsFilePath of stringsFilePaths) {
    const lprojDirectory = dirname(stringsFilePath);
    const lprojDirectoryName = basename(lprojDirectory);

    if (!lprojDirectoryName.endsWith(LPROJ_SUFFIX)) {
      violations.push({
        rule: "strings-file-outside-lproj",
        file: relative(REPO_ROOT, stringsFilePath),
        parentDirectory: relative(REPO_ROOT, lprojDirectory),
      });
      continue;
    }

    const locale = lprojDirectoryName.slice(0, -LPROJ_SUFFIX.length);
    const groupDirectory = dirname(lprojDirectory);
    const stringsFileName = basename(stringsFilePath);
    const groupId = `${relative(REPO_ROOT, groupDirectory)}/*${LPROJ_SUFFIX}/${stringsFileName}`;
    const group = groups.get(groupId);

    if (group === undefined) {
      groups.set(groupId, {
        groupId,
        groupDirectory,
        stringsFileName,
        filePathsByLocale: new Map([[locale, stringsFilePath]]),
      });
      continue;
    }

    group.filePathsByLocale.set(locale, stringsFilePath);
  }

  return { groups: [...groups.values()], violations };
}

function findMissingLocaleFiles(group) {
  return REQUIRED_LOCALES.filter((locale) => !group.filePathsByLocale.has(locale)).map((locale) => ({
    rule: "missing-locale-file",
    group: group.groupId,
    locale,
    expectedFile: relative(
      REPO_ROOT,
      join(group.groupDirectory, `${locale}${LPROJ_SUFFIX}`, group.stringsFileName),
    ),
  }));
}

function findStringsContentViolations(group) {
  const parsedByLocale = new Map(
    [...group.filePathsByLocale].map(([locale, filePath]) => [locale, parseStringsKeys(filePath)]),
  );
  const parseViolations = [...parsedByLocale.values()]
    .filter(({ violation }) => violation !== null)
    .map(({ violation }) => violation);
  const keysByLocale = new Map(
    [...parsedByLocale]
      .filter(([, parsed]) => parsed.keys !== null)
      .map(([locale, parsed]) => [locale, parsed.keys]),
  );
  const referenceKeys = [...new Set([...keysByLocale.values()].flatMap((keys) => [...keys]))].sort();
  const missingKeyViolations = [...keysByLocale]
    .map(([locale, keys]) => ({
      locale,
      missingKeys: referenceKeys.filter((key) => !keys.has(key)),
    }))
    .filter(({ missingKeys }) => missingKeys.length > 0)
    .map(({ locale, missingKeys }) => ({
      rule: "missing-strings-key",
      group: group.groupId,
      locale,
      file: relative(REPO_ROOT, group.filePathsByLocale.get(locale)),
      missingKeys,
    }));

  return [...parseViolations, ...missingKeyViolations];
}

// A localization holds either a single stringUnit or variations (plural/device) whose cases nest
// one level below the variation kind.
function collectStringUnits(localization) {
  if (!isPlainObject(localization)) {
    return [];
  }

  if (localization.stringUnit !== undefined) {
    return [localization.stringUnit];
  }

  if (!isPlainObject(localization.variations)) {
    return [];
  }

  return Object.values(localization.variations)
    .filter((variationCases) => isPlainObject(variationCases))
    .flatMap((variationCases) =>
      Object.values(variationCases).flatMap((variationCase) => collectStringUnits(variationCase)),
    );
}

function findStringUnitProblem(stringUnit) {
  if (!isPlainObject(stringUnit)) {
    return "invalid-string-unit";
  }

  if (typeof stringUnit.state !== "string") {
    return "missing-state";
  }

  if (stringUnit.state !== TRANSLATED_STATE) {
    return stringUnit.state;
  }

  if (typeof stringUnit.value !== "string" || stringUnit.value.length === 0) {
    return "empty-value";
  }

  return null;
}

// Xcode records an untranslated string as a present locale entry with a non-translated state, so
// locale presence alone is not evidence of a translation.
function findUntranslatedState(localizations, locale) {
  if (!Object.hasOwn(localizations, locale)) {
    return "missing";
  }

  const stringUnits = collectStringUnits(localizations[locale]);

  if (stringUnits.length === 0) {
    return "no-string-unit";
  }

  const problem = stringUnits.map(findStringUnitProblem).find((state) => state !== null);

  return problem === undefined ? null : problem;
}

function findCatalogViolations(catalogFilePath) {
  const file = relative(REPO_ROOT, catalogFilePath);
  const { catalogStrings, violation } = parseStringCatalog(catalogFilePath);

  if (catalogStrings === null) {
    return [violation];
  }

  return Object.entries(catalogStrings).flatMap(([stringKey, entry]) => {
    if (!isPlainObject(entry)) {
      return [
        { rule: "invalid-catalog-entry", file, stringKey, reason: "entry is not a JSON object" },
      ];
    }

    if (entry.shouldTranslate === false) {
      return [];
    }

    const localizations = entry.localizations === undefined ? {} : entry.localizations;

    if (!isPlainObject(localizations)) {
      return [
        {
          rule: "invalid-catalog-entry",
          file,
          stringKey,
          reason: '"localizations" is not a JSON object',
        },
      ];
    }

    const untranslatedLocales = REQUIRED_LOCALES.map((locale) => ({
      locale,
      state: findUntranslatedState(localizations, locale),
    })).filter(({ state }) => state !== null);

    if (untranslatedLocales.length === 0) {
      return [];
    }

    return [{ rule: "untranslated-catalog-locale", file, stringKey, untranslatedLocales }];
  });
}

const localizationFilePaths = listLocalizationFiles(IOS_ROOT).sort();
const stringsFilePaths = localizationFilePaths.filter((filePath) => filePath.endsWith(".strings"));
const catalogFilePaths = localizationFilePaths.filter((filePath) => filePath.endsWith(".xcstrings"));

if (stringsFilePaths.length === 0) {
  console.error("No iOS .strings files found.", { iosRoot: relative(REPO_ROOT, IOS_ROOT) });
  process.exit(1);
}

if (catalogFilePaths.length === 0) {
  console.error("No iOS .xcstrings catalogs found.", { iosRoot: relative(REPO_ROOT, IOS_ROOT) });
  process.exit(1);
}

const { groups: stringsGroups, violations: groupingViolations } =
  groupStringsFilesByLprojParent(stringsFilePaths);
const violations = [
  ...findKnownRegionsViolations(),
  ...groupingViolations,
  ...stringsGroups.flatMap(findMissingLocaleFiles),
  ...stringsGroups.flatMap(findStringsContentViolations),
  ...catalogFilePaths.flatMap(findCatalogViolations),
];

if (violations.length > 0) {
  for (const violation of violations) {
    console.error("iOS localization parity violation.", violation);
  }

  console.error("iOS localization parity check failed.", {
    violationCount: violations.length,
    requiredLocales: REQUIRED_LOCALES,
  });
  process.exit(1);
}

console.log("iOS localization parity check passed.", {
  stringsGroups: stringsGroups.length,
  stringsFiles: stringsFilePaths.length,
  catalogs: catalogFilePaths.length,
  requiredLocales: REQUIRED_LOCALES,
});
