import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const I18N_ROOT = join(REPO_ROOT, "apps", "web", "src", "i18n");
const CATALOGS_ROOT = join(I18N_ROOT, "catalogs");
const TYPES_FILE = join(I18N_ROOT, "types.ts");
const CATALOG_MODULE_SUFFIX = ".ts";
const CATALOG_MODULE_SPECIFIER_PREFIX = "./catalogs/";
const LOCALE_NAMES_PATH = ["locale", "names"];

// catalog.ts registers a locale as one entry of the lazy loader record
// `Readonly<Record<Locale, () => Promise<TranslationCatalog>>>`: one dynamic import per locale, with
// the default locale resolved from its static import. This check asserts the loader record keys, not
// an eager `Record<Locale, TranslationCatalog>` of static imports, which the file no longer holds.
const CATALOG_LOADERS_RECORD = {
  recordFile: join(I18N_ROOT, "catalog.ts"),
  record: "translationCatalogLoaders",
};
const REGISTRATION_RECORDS = [
  { recordFile: join(I18N_ROOT, "locales.ts"), record: "localeDirections" },
  { recordFile: join(I18N_ROOT, "weekContext.ts"), record: "localeFirstDayFallbacks" },
];

const WHITESPACE_PATTERN = /\s+/y;
const LINE_COMMENT_PATTERN = /\/\/[^\n]*/y;
const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//y;
const OBJECT_KEY_PATTERN = /(?:"([^"\\]+)"|([A-Za-z_$][\w$]*))\s*:/y;
const STRING_LITERAL_PATTERN = /"([^"\\]*)"/y;
// Catalog modules declare the literal as `const xCatalog = {`, `const xCatalog: TranslationCatalog = {`
// or `export const xCatalog = {`, so the optional type annotation is part of the declaration.
const CATALOG_DECLARATION_PATTERN = /\bconst\s+[A-Za-z_$][\w$]*Catalog\s*(?::[^={;]+)?=\s*\{/g;
const DEFAULT_LOCALE_PATTERN = /\bconst\s+defaultLocale\s*(?::[^={;]+)?=\s*"([^"\\]+)"/g;
const IMPORT_CALL_PATTERN = /\bimport\s*\(/y;
const STATIC_IMPORT_PATTERN = /\bimport\s*\{([^{}]*)\}\s*from\s*"([^"\\]*)"/y;
const IMPORT_BINDING_PATTERN = /^(?:[A-Za-z_$][\w$]*\s+as\s+)?([A-Za-z_$][\w$]*)$/;
const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/y;
const OPENING_BRACKETS = new Set(["{", "[", "("]);
const CLOSING_BRACKETS = new Set(["}", "]", ")"]);
const QUOTES = new Set(['"', "'", "`"]);

function catalogModulePath(locale) {
  return join(CATALOGS_ROOT, `${locale}${CATALOG_MODULE_SUFFIX}`);
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

function skipStringLiteral(content, startIndex) {
  const quote = content[startIndex];
  let index = startIndex + 1;

  while (index < content.length) {
    if (content[index] === "\\") {
      index += 2;
      continue;
    }

    if (content[index] === quote) {
      return index + 1;
    }

    index += 1;
  }

  return content.length;
}

function readBalancedBlock(content, openIndex) {
  let index = openIndex;
  let depth = 0;

  while (index < content.length) {
    const skippedIndex = skipWhitespaceAndComments(content, index);

    if (skippedIndex !== index) {
      index = skippedIndex;
      continue;
    }

    const char = content[index];

    if (QUOTES.has(char)) {
      index = skipStringLiteral(content, index);
      continue;
    }

    if (OPENING_BRACKETS.has(char)) {
      depth += 1;
      index += 1;
      continue;
    }

    if (CLOSING_BRACKETS.has(char)) {
      depth -= 1;
      index += 1;

      if (depth === 0) {
        return { body: content.slice(openIndex + 1, index - 1), endIndex: index };
      }

      continue;
    }

    index += 1;
  }

  return null;
}

// Returns the index just past the entry separator, so an object or array body can be walked entry by
// entry without interpreting the values themselves.
function readEntryEnd(body, valueIndex) {
  let index = valueIndex;
  let depth = 0;

  while (index < body.length) {
    const skippedIndex = skipWhitespaceAndComments(body, index);

    if (skippedIndex !== index) {
      index = skippedIndex;
      continue;
    }

    const char = body[index];

    if (QUOTES.has(char)) {
      index = skipStringLiteral(body, index);
      continue;
    }

    if (OPENING_BRACKETS.has(char)) {
      depth += 1;
      index += 1;
      continue;
    }

    if (CLOSING_BRACKETS.has(char)) {
      if (depth === 0) {
        return null;
      }

      depth -= 1;
      index += 1;
      continue;
    }

    if (char === "," && depth === 0) {
      return index + 1;
    }

    index += 1;
  }

  return depth === 0 ? body.length : null;
}

function parseObjectEntries(body) {
  const entries = [];
  let index = skipWhitespaceAndComments(body, 0);

  while (index < body.length) {
    OBJECT_KEY_PATTERN.lastIndex = index;
    const keyMatch = OBJECT_KEY_PATTERN.exec(body);

    if (keyMatch === null) {
      return null;
    }

    const valueIndex = skipWhitespaceAndComments(body, OBJECT_KEY_PATTERN.lastIndex);
    const valueBlock = body[valueIndex] === "{" ? readBalancedBlock(body, valueIndex) : null;
    const entryEndIndex = readEntryEnd(body, valueIndex);

    if (entryEndIndex === null) {
      return null;
    }

    entries.push({
      key: keyMatch[1] ?? keyMatch[2],
      valueBody: valueBlock === null ? null : valueBlock.body,
      valueText: body.slice(valueIndex, entryEndIndex),
    });
    index = skipWhitespaceAndComments(body, entryEndIndex);
  }

  return entries;
}

// Dynamic import specifiers of one entry value, read with the same string- and comment-aware scan as
// the rest of the file so an `import("...")` written inside a string or a comment is not counted.
// Returns null when a dynamic import does not carry a plain double-quoted specifier.
function readImportSpecifiers(valueText) {
  const specifiers = [];
  let index = 0;

  while (index < valueText.length) {
    const skippedIndex = skipWhitespaceAndComments(valueText, index);

    if (skippedIndex !== index) {
      index = skippedIndex;
      continue;
    }

    if (QUOTES.has(valueText[index])) {
      index = skipStringLiteral(valueText, index);
      continue;
    }

    IMPORT_CALL_PATTERN.lastIndex = index;

    if (IMPORT_CALL_PATTERN.exec(valueText) === null) {
      index += 1;
      continue;
    }

    const specifierIndex = skipWhitespaceAndComments(valueText, IMPORT_CALL_PATTERN.lastIndex);
    STRING_LITERAL_PATTERN.lastIndex = specifierIndex;
    const specifierMatch = STRING_LITERAL_PATTERN.exec(valueText);

    if (specifierMatch === null) {
      return null;
    }

    specifiers.push(specifierMatch[1]);
    index = STRING_LITERAL_PATTERN.lastIndex;
  }

  return specifiers;
}

// Local binding names a static `import { ... } from "./catalogs/<defaultLocale>"` introduces, read
// with the same string- and comment-aware scan so an import written inside a string or a comment is
// not counted. Returns null when such an import holds a binding clause this check cannot read.
function readStaticCatalogBindings(content, locale) {
  const expectedSpecifier = `${CATALOG_MODULE_SPECIFIER_PREFIX}${locale}`;
  const bindings = [];
  let index = 0;

  while (index < content.length) {
    const skippedIndex = skipWhitespaceAndComments(content, index);

    if (skippedIndex !== index) {
      index = skippedIndex;
      continue;
    }

    if (QUOTES.has(content[index])) {
      index = skipStringLiteral(content, index);
      continue;
    }

    STATIC_IMPORT_PATTERN.lastIndex = index;
    const importMatch = STATIC_IMPORT_PATTERN.exec(content);

    if (importMatch === null) {
      index += 1;
      continue;
    }

    index = STATIC_IMPORT_PATTERN.lastIndex;

    if (importMatch[2] !== expectedSpecifier) {
      continue;
    }

    for (const clause of importMatch[1].split(",")) {
      const trimmedClause = clause.trim();

      if (trimmedClause.length === 0) {
        continue;
      }

      const bindingMatch = IMPORT_BINDING_PATTERN.exec(trimmedClause);

      if (bindingMatch === null) {
        return null;
      }

      bindings.push(bindingMatch[1]);
    }
  }

  return bindings;
}

// Identifiers one entry value references, read with the same string- and comment-aware scan so a
// binding named only inside a string or a comment does not count as a reference.
function readReferencedIdentifiers(valueText) {
  const identifiers = new Set();
  let index = 0;

  while (index < valueText.length) {
    const skippedIndex = skipWhitespaceAndComments(valueText, index);

    if (skippedIndex !== index) {
      index = skippedIndex;
      continue;
    }

    if (QUOTES.has(valueText[index])) {
      index = skipStringLiteral(valueText, index);
      continue;
    }

    IDENTIFIER_PATTERN.lastIndex = index;
    const identifierMatch = IDENTIFIER_PATTERN.exec(valueText);

    if (identifierMatch === null) {
      index += 1;
      continue;
    }

    identifiers.add(identifierMatch[0]);
    index = IDENTIFIER_PATTERN.lastIndex;
  }

  return identifiers;
}

function parseStringArrayItems(body) {
  const items = [];
  let index = skipWhitespaceAndComments(body, 0);

  while (index < body.length) {
    STRING_LITERAL_PATTERN.lastIndex = index;
    const itemMatch = STRING_LITERAL_PATTERN.exec(body);

    if (itemMatch === null) {
      return null;
    }

    items.push(itemMatch[1]);
    index = skipWhitespaceAndComments(body, STRING_LITERAL_PATTERN.lastIndex);

    if (index < body.length) {
      if (body[index] !== ",") {
        return null;
      }

      index = skipWhitespaceAndComments(body, index + 1);
    }
  }

  return items;
}

// Anchored on the assignment, so a bracket inside a type annotation such as `readonly string[]` is
// never read as the literal. The annotation is matched only up to the first `{`, `=` or `;`, so an
// annotation carrying one of those ends the match early and the literal is taken as the first opening
// bracket after that point: still correct for `Record<Locale, () => Promise<T>>`, and loud — an
// unreadable body or a key set that is not the locale tags — for an annotation holding its own `{`.
function findDeclarationBody(content, declarationName, openBracket) {
  const declarationPattern = new RegExp(`\\bconst\\s+${declarationName}\\s*(?::[^={;]+)?=`, "g");
  const declarations = [...content.matchAll(declarationPattern)];

  if (declarations.length !== 1) {
    return {
      body: null,
      reason: `expected exactly one "const ${declarationName} =" declaration, found ${declarations.length}`,
    };
  }

  const declaration = declarations[0];
  const openIndex = content.indexOf(openBracket, declaration.index + declaration[0].length);

  if (openIndex === -1) {
    return { body: null, reason: `no "${openBracket}" follows "const ${declarationName} ="` };
  }

  const block = readBalancedBlock(content, openIndex);

  if (block === null) {
    return { body: null, reason: `unbalanced "${openBracket}" block for "const ${declarationName}"` };
  }

  return { body: block.body, reason: null };
}

function readNestedObjectKeys(objectBody, path) {
  let entries = parseObjectEntries(objectBody);

  for (const segment of path) {
    if (entries === null) {
      return null;
    }

    const entry = entries.find((candidate) => candidate.key === segment);

    if (entry === undefined || entry.valueBody === null) {
      return null;
    }

    entries = parseObjectEntries(entry.valueBody);
  }

  return entries === null ? null : entries.map((entry) => entry.key);
}

// supportedLocales is the single source of truth every other locale surface is compared against, so
// an unreadable or empty list fails the check instead of letting every other rule pass vacuously.
// defaultLocale is read alongside it because it is the one locale whose loader carries no import.
function readLocaleSource() {
  const file = relative(REPO_ROOT, TYPES_FILE);
  const unreadable = { supportedLocales: null, defaultLocale: null };

  if (!existsSync(TYPES_FILE)) {
    return { ...unreadable, violation: { rule: "missing-locale-source", file } };
  }

  const content = readFileSync(TYPES_FILE, "utf8");
  const { body, reason } = findDeclarationBody(content, "supportedLocales", "[");

  if (body === null) {
    return { ...unreadable, violation: { rule: "unparsable-locale-list", file, reason } };
  }

  const locales = parseStringArrayItems(body);

  if (locales === null) {
    return {
      ...unreadable,
      violation: {
        rule: "unparsable-locale-list",
        file,
        reason: "supportedLocales holds an entry that is not a plain double-quoted string",
      },
    };
  }

  if (locales.length === 0) {
    return { ...unreadable, violation: { rule: "empty-locale-list", file } };
  }

  const duplicateLocales = locales.filter((locale, position) => locales.indexOf(locale) !== position);

  if (duplicateLocales.length > 0) {
    return {
      ...unreadable,
      violation: { rule: "duplicate-supported-locale", file, duplicateLocales },
    };
  }

  const defaultLocales = [...content.matchAll(DEFAULT_LOCALE_PATTERN)].map((match) => match[1]);

  if (defaultLocales.length !== 1) {
    return {
      ...unreadable,
      violation: {
        rule: "unparsable-default-locale",
        file,
        reason: `expected exactly one \`const defaultLocale = "<tag>"\` declaration, found ${defaultLocales.length}`,
      },
    };
  }

  if (!locales.includes(defaultLocales[0])) {
    return {
      ...unreadable,
      violation: { rule: "unsupported-default-locale", file, defaultLocale: defaultLocales[0] },
    };
  }

  return { supportedLocales: locales, defaultLocale: defaultLocales[0], violation: null };
}

// The one directory listing every catalog rule is derived from, so a catalog misnamed only by case
// cannot look present to one rule and absent to another between macOS and Linux CI.
function readCatalogLocales() {
  if (!existsSync(CATALOGS_ROOT)) {
    return {
      catalogLocales: null,
      violation: { rule: "missing-catalogs-directory", file: relative(REPO_ROOT, CATALOGS_ROOT) },
    };
  }

  const catalogLocales = readdirSync(CATALOGS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(CATALOG_MODULE_SUFFIX))
    .map((entry) => entry.name.slice(0, -CATALOG_MODULE_SUFFIX.length));

  return { catalogLocales, violation: null };
}

function findCatalogModuleViolations(supportedLocales, presentLocales) {
  const presentLocaleSet = new Set(presentLocales);
  const supportedLocaleSet = new Set(supportedLocales);

  return [
    ...supportedLocales
      .filter((locale) => !presentLocaleSet.has(locale))
      .map((locale) => ({
        rule: "missing-catalog-module",
        file: relative(REPO_ROOT, catalogModulePath(locale)),
        locale,
      })),
    ...presentLocales
      .filter((locale) => !supportedLocaleSet.has(locale))
      .map((locale) => ({
        rule: "unsupported-catalog-module",
        file: relative(REPO_ROOT, catalogModulePath(locale)),
        locale,
        supportedLocalesFile: relative(REPO_ROOT, TYPES_FILE),
      })),
  ];
}

function readRecordEntries(recordFile, record) {
  const file = relative(REPO_ROOT, recordFile);

  if (!existsSync(recordFile)) {
    return {
      entries: null,
      content: null,
      violations: [{ rule: "missing-registration-source", file, record }],
    };
  }

  const content = readFileSync(recordFile, "utf8");
  const { body, reason } = findDeclarationBody(content, record, "{");

  if (body === null) {
    return {
      entries: null,
      content,
      violations: [{ rule: "unparsable-record", file, record, reason }],
    };
  }

  const entries = parseObjectEntries(body);

  if (entries === null) {
    return {
      entries: null,
      content,
      violations: [
        {
          rule: "unparsable-record",
          file,
          record,
          reason: "record holds an entry this check cannot read as a key/value pair",
        },
      ],
    };
  }

  return { entries, content, violations: [] };
}

// Every registration record is typed as Record<Locale, ...>, so its key set must equal
// supportedLocales exactly in both directions.
function findRecordKeyViolations(supportedLocales, registeredLocales, file, record) {
  const registeredLocaleSet = new Set(registeredLocales);
  const supportedLocaleSet = new Set(supportedLocales);

  return [
    ...supportedLocales
      .filter((locale) => !registeredLocaleSet.has(locale))
      .map((locale) => ({ rule: "missing-locale-registration", file, record, locale })),
    ...registeredLocales
      .filter((locale) => !supportedLocaleSet.has(locale))
      .map((locale) => ({
        rule: "unsupported-locale-registration",
        file,
        record,
        locale,
        supportedLocalesFile: relative(REPO_ROOT, TYPES_FILE),
      })),
  ];
}

function findRegistrationViolations(supportedLocales, { recordFile, record }) {
  const { entries, violations } = readRecordEntries(recordFile, record);

  if (entries === null) {
    return violations;
  }

  return findRecordKeyViolations(
    supportedLocales,
    entries.map((entry) => entry.key),
    relative(REPO_ROOT, recordFile),
    record,
  );
}

// A loader importing another locale's catalog satisfies the same TranslationCatalog type, so the tag
// in the dynamic import specifier is the only thing tying a locale to its own catalog module, and a
// mismatch ships one language's UI under another language's name.
function findDefaultLoaderBindingViolations(entry, defaultCatalog, file, record) {
  const expectedSpecifier = `${CATALOG_MODULE_SPECIFIER_PREFIX}${defaultCatalog.locale}`;

  if (defaultCatalog.bindings === null) {
    return [
      {
        rule: "missing-default-catalog-import",
        file,
        record,
        locale: entry.key,
        expectedSpecifier,
        reason: `the static import of "${expectedSpecifier}" holds a binding this check cannot read`,
      },
    ];
  }

  if (defaultCatalog.bindings.length === 0) {
    return [
      {
        rule: "missing-default-catalog-import",
        file,
        record,
        locale: entry.key,
        expectedSpecifier,
        reason: `no static \`import { <binding> } from "${expectedSpecifier}"\` in this file`,
      },
    ];
  }

  const referencedIdentifiers = readReferencedIdentifiers(entry.valueText);

  if (defaultCatalog.bindings.some((binding) => referencedIdentifiers.has(binding))) {
    return [];
  }

  return [
    {
      rule: "mismatched-catalog-import",
      file,
      record,
      locale: entry.key,
      expectedSpecifier,
      staticBindings: defaultCatalog.bindings,
    },
  ];
}

function findLoaderSpecifierViolations(entry, defaultCatalog, file, record) {
  const specifiers = readImportSpecifiers(entry.valueText);

  if (specifiers === null) {
    return [
      {
        rule: "unparsable-catalog-loader",
        file,
        record,
        locale: entry.key,
        reason: "loader holds a dynamic import whose specifier is not a plain double-quoted string",
      },
    ];
  }

  // The default locale resolves its statically imported catalog, so it is the one loader allowed to
  // carry no dynamic import, and the one whose catalog module is named by that import instead of by a
  // specifier of its own.
  if (specifiers.length === 0 && entry.key === defaultCatalog.locale) {
    return findDefaultLoaderBindingViolations(entry, defaultCatalog, file, record);
  }

  const expectedSpecifier = `${CATALOG_MODULE_SPECIFIER_PREFIX}${entry.key}`;

  if (specifiers.length === 1 && specifiers[0] === expectedSpecifier) {
    return [];
  }

  return [
    {
      rule: "mismatched-catalog-import",
      file,
      record,
      locale: entry.key,
      expectedSpecifier,
      specifiers,
    },
  ];
}

function findCatalogLoaderViolations(supportedLocales, defaultLocale) {
  const { recordFile, record } = CATALOG_LOADERS_RECORD;
  const file = relative(REPO_ROOT, recordFile);
  const { entries, content, violations } = readRecordEntries(recordFile, record);

  if (entries === null) {
    return violations;
  }

  const defaultCatalog = {
    locale: defaultLocale,
    bindings: readStaticCatalogBindings(content, defaultLocale),
  };

  return [
    ...findRecordKeyViolations(
      supportedLocales,
      entries.map((entry) => entry.key),
      file,
      record,
    ),
    ...entries.flatMap((entry) =>
      findLoaderSpecifierViolations(entry, defaultCatalog, file, record),
    ),
  ];
}

// A locale.names key may exist for a tag that has no catalog yet, so names are only required to
// cover supportedLocales and never compared back against it.
function findLocaleNameViolations(supportedLocales, catalogLocale) {
  const catalogFile = catalogModulePath(catalogLocale);
  const file = relative(REPO_ROOT, catalogFile);
  const content = readFileSync(catalogFile, "utf8");
  const declarations = [...content.matchAll(CATALOG_DECLARATION_PATTERN)];

  if (declarations.length !== 1) {
    return [
      {
        rule: "unparsable-catalog",
        file,
        locale: catalogLocale,
        reason: `expected exactly one "const <name>Catalog = {" declaration, found ${declarations.length}`,
      },
    ];
  }

  const declaration = declarations[0];
  const catalogBlock = readBalancedBlock(
    content,
    declaration.index + declaration[0].length - 1,
  );

  if (catalogBlock === null) {
    return [
      {
        rule: "unparsable-catalog",
        file,
        locale: catalogLocale,
        reason: "catalog object literal is unbalanced",
      },
    ];
  }

  const localeNameKeys = readNestedObjectKeys(catalogBlock.body, LOCALE_NAMES_PATH);

  if (localeNameKeys === null) {
    return [
      {
        rule: "unparsable-catalog",
        file,
        locale: catalogLocale,
        reason: `no readable "${LOCALE_NAMES_PATH.join(".")}" object`,
      },
    ];
  }

  const localeNameKeySet = new Set(localeNameKeys);

  return supportedLocales
    .filter((locale) => !localeNameKeySet.has(locale))
    .map((locale) => ({
      rule: "missing-locale-name",
      file,
      catalogLocale,
      record: LOCALE_NAMES_PATH.join("."),
      locale,
    }));
}

const { supportedLocales, defaultLocale, violation: localeSourceViolation } = readLocaleSource();

if (supportedLocales === null) {
  console.error("Web localization parity violation.", localeSourceViolation);
  console.error("Web localization parity check failed.", { violationCount: 1 });
  process.exit(1);
}

const { catalogLocales, violation: catalogsDirectoryViolation } = readCatalogLocales();

if (catalogLocales === null) {
  console.error("Web localization parity violation.", catalogsDirectoryViolation);
  console.error("Web localization parity check failed.", { violationCount: 1 });
  process.exit(1);
}

const catalogLocaleSet = new Set(catalogLocales);
const supportedCatalogLocales = supportedLocales.filter((locale) => catalogLocaleSet.has(locale));
const violations = [
  ...findCatalogModuleViolations(supportedLocales, catalogLocales),
  ...findCatalogLoaderViolations(supportedLocales, defaultLocale),
  ...REGISTRATION_RECORDS.flatMap((registrationRecord) =>
    findRegistrationViolations(supportedLocales, registrationRecord),
  ),
  ...supportedCatalogLocales.flatMap((catalogLocale) =>
    findLocaleNameViolations(supportedLocales, catalogLocale),
  ),
];

if (violations.length > 0) {
  for (const violation of violations) {
    console.error("Web localization parity violation.", violation);
  }

  console.error("Web localization parity check failed.", {
    violationCount: violations.length,
    supportedLocales,
  });
  process.exit(1);
}

console.log("Web localization parity check passed.", {
  supportedLocales,
  defaultLocale,
  catalogs: supportedCatalogLocales.length,
  registrationRecords: [CATALOG_LOADERS_RECORD, ...REGISTRATION_RECORDS].map(({ record }) => record),
});
