import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Catches the iOS unit test compile break where a nonisolated XCTest function reaches a
// @MainActor-isolated app symbol. Nothing type-checks Swift before merge by design, and the
// Xcode Cloud "Test - iOS" action is intentionally non-required, so such a break can sit on main
// unnoticed for days. The rule is deliberately textual and narrow:
//
//   1. collect the @MainActor type and top-level function names declared in the app target;
//   2. collect the XCTest functions that are neither annotated with @MainActor nor hosted by a
//      main-actor-isolated test class;
//   3. flag such a test function when its body names one of the collected symbols.
//
// Known limits, accepted on purpose to keep the rule small and readable:
//   - a test function body ends at the function's own closing brace, or at the next test
//     declaration when that comes first; a function whose closing brace is not a lone `}` at the
//     declaration's own indentation falls back to the next test declaration and can pick up
//     trailing helper code;
//   - a declaration whose modifiers are not all listed below is not recognized as a declaration at
//     all, so an unlisted modifier makes the check miss a test rather than invent a violation;
//   - references inside comments or string literals count as references;
//   - a collected top-level function name is also matched when it is used as a method call;
//   - a nonisolated `async` test may legally `await` a main-actor symbol; it is still flagged, and
//     the @MainActor annotation asked for below is what every isolated test here already carries.
//
// Every limit only ever asks for one extra @MainActor annotation, which is the house convention in
// this test target, so the check stays safe to fail on.

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const APP_SOURCE_DIR = join(REPO_ROOT, "apps", "ios", "Flashcards", "Flashcards");
const TEST_SOURCE_DIR = join(REPO_ROOT, "apps", "ios", "Flashcards", "FlashcardsTests");
// FlashcardsUITests is intentionally not scanned: it runs out of process and never
// `@testable import Flashcards`, so app actor isolation does not reach it.
const IGNORED_DIRECTORY_NAMES = new Set(["DerivedData", "build", ".build", ".git"]);

const MAIN_ACTOR_ATTRIBUTE = "@MainActor";
const ATTRIBUTE = String.raw`@[A-Za-z_]\w*(?:\([^)]*\))?`;
const ACCESS_MODIFIER = "open|package|public|internal|private|fileprivate";
// `nonisolated` is listed so that `nonisolated func testX()` — the explicit way to opt a test out
// of an enclosing @MainActor class, and therefore the most likely shape of this defect — is still
// collected as a candidate test function.
const METHOD_MODIFIER = String.raw`static|class|override|mutating|nonisolated(?:\([A-Za-z]+\))?`;
const TYPE_MODIFIER = String.raw`(?:${ATTRIBUTE}|final|${ACCESS_MODIFIER})\s+`;
const FUNCTION_MODIFIER = String.raw`(?:${TYPE_MODIFIER}|(?:${METHOD_MODIFIER})\s+)`;
const TYPE_MODIFIERS = String.raw`(?<modifiers>(?:${TYPE_MODIFIER})*)`;
const FUNCTION_MODIFIERS = String.raw`(?<modifiers>(?:${FUNCTION_MODIFIER})*)`;
const INDENTATION = String.raw`(?<indentation>[\t ]*)`;
// `class func` and `class var` are member declarations, not type declarations.
const DECLARATION_NAME = String.raw`(?!(?:func|var|let|subscript)\b)[A-Za-z_]\w*`;

const ATTRIBUTE_ONLY_LINE_PATTERN = new RegExp(String.raw`^${ATTRIBUTE}$`);
const COMMENT_ONLY_LINE_PATTERN = /^\/\//;
const FILE_SCOPED_MODIFIER_PATTERN = /\b(?:private|fileprivate)\b/;
const NONISOLATED_MODIFIER_PATTERN = /\bnonisolated\b/;
const GENERIC_ARGUMENTS_PATTERN = /<[^>]*>/g;
// Anchored so only real declarations match: everything before the keyword has to be a modifier or
// an attribute, which keeps `Task { @MainActor in` and `let handler: @MainActor () -> Void` out.
const TYPE_DECLARATION_PATTERN = new RegExp(
  String.raw`^${TYPE_MODIFIERS}(?:class|struct|enum|actor)\s+(?<name>${DECLARATION_NAME})`,
);
// Matched against the raw line, so `^` also enforces the column-zero (top-level) requirement.
const TOP_LEVEL_FUNCTION_DECLARATION_PATTERN = new RegExp(
  String.raw`^${FUNCTION_MODIFIERS}func\s+(?<name>[A-Za-z_]\w*)`,
);
const TEST_FUNCTION_DECLARATION_PATTERN = new RegExp(
  String.raw`^${INDENTATION}${FUNCTION_MODIFIERS}func\s+(?<name>test\w*)`,
);
const CLASS_DECLARATION_PATTERN = new RegExp(
  String.raw`^${INDENTATION}${TYPE_MODIFIERS}class\s+` +
    String.raw`(?<name>${DECLARATION_NAME})(?<inheritance>[^{]*)`,
);
const EXTENSION_DECLARATION_PATTERN = new RegExp(
  String.raw`^${INDENTATION}${TYPE_MODIFIERS}extension\s+(?<name>[A-Za-z_][\w.]*)`,
);
// Captures the full identifier, so a longer name such as `FakeFlashcardsStore` never matches a
// shorter collected symbol. A type counts as referenced through `Name.` or `Name(`, a top-level
// function only through `name(`.
const SYMBOL_REFERENCE_PATTERN = /\b([A-Za-z_]\w*)([.(])/g;

function listSwiftFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return IGNORED_DIRECTORY_NAMES.has(entry.name) ? [] : listSwiftFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".swift") ? [entryPath] : [];
  });
}

function readSwiftLines(filePath) {
  return readFileSync(filePath, "utf8").split("\n");
}

function isFileScoped(modifiers) {
  return FILE_SCOPED_MODIFIER_PATTERN.test(modifiers);
}

// `nonisolated` opts a member out of its container's isolation, so such a test stays a candidate
// even inside a @MainActor test class.
function isExplicitlyNonisolated(modifiers) {
  return NONISOLATED_MODIFIER_PATTERN.test(modifiers);
}

// @MainActor either sits inline in front of the declaration keyword or on one of the attribute
// lines directly above it, as in `@MainActor` + `@Observable` + `final class FlashcardsStore`.
function isMainActorAnnotated(lines, declarationLineIndex, modifiers) {
  if (modifiers.includes(MAIN_ACTOR_ATTRIBUTE)) {
    return true;
  }

  for (let lineIndex = declarationLineIndex - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex].trim();

    if (line === MAIN_ACTOR_ATTRIBUTE) {
      return true;
    }

    if (ATTRIBUTE_ONLY_LINE_PATTERN.test(line) || COMMENT_ONLY_LINE_PATTERN.test(line)) {
      continue;
    }

    return false;
  }

  return false;
}

// private and fileprivate app declarations stay invisible to the test target even under
// @testable import, so they can never be the symbol a test fails to compile against.
function collectMainActorAppSymbols(swiftFilePaths) {
  const typeNames = new Set();
  const functionNames = new Set();

  for (const filePath of swiftFilePaths) {
    const lines = readSwiftLines(filePath);

    lines.forEach((line, lineIndex) => {
      const typeMatch = TYPE_DECLARATION_PATTERN.exec(line.trim());

      if (
        typeMatch !== null &&
        !isFileScoped(typeMatch.groups.modifiers) &&
        isMainActorAnnotated(lines, lineIndex, typeMatch.groups.modifiers)
      ) {
        typeNames.add(typeMatch.groups.name);
      }

      // Methods are reached through their owning type, which the type set already covers, so only
      // top-level functions are collected here.
      const functionMatch = TOP_LEVEL_FUNCTION_DECLARATION_PATTERN.exec(line);

      if (
        functionMatch !== null &&
        !isFileScoped(functionMatch.groups.modifiers) &&
        isMainActorAnnotated(lines, lineIndex, functionMatch.groups.modifiers)
      ) {
        functionNames.add(functionMatch.groups.name);
      }
    });
  }

  return { typeNames, functionNames };
}

// Swift requires the superclass to be the first entry of the inheritance clause; the remaining
// entries are protocols and are irrelevant to actor isolation.
function parseSuperclassName(inheritanceClause) {
  const firstInheritedType = inheritanceClause
    .replace(GENERIC_ARGUMENTS_PATTERN, "")
    .split(/\bwhere\b/)[0]
    .replace(/^\s*:/, "")
    .split(",")[0];
  const identifierMatch = /[A-Za-z_]\w*/.exec(firstInheritedType);

  return identifierMatch === null ? null : identifierMatch[0];
}

function collectContainerDeclarations(lines) {
  const containers = [];

  lines.forEach((line, lineIndex) => {
    const classMatch = CLASS_DECLARATION_PATTERN.exec(line);

    if (classMatch !== null) {
      containers.push({
        kind: "class",
        name: classMatch.groups.name,
        superclassName: parseSuperclassName(classMatch.groups.inheritance),
        isMainActor: isMainActorAnnotated(lines, lineIndex, classMatch.groups.modifiers),
        indentation: classMatch.groups.indentation.length,
        lineIndex,
      });
      return;
    }

    const extensionMatch = EXTENSION_DECLARATION_PATTERN.exec(line);

    if (extensionMatch !== null) {
      containers.push({
        kind: "extension",
        name: extensionMatch.groups.name,
        superclassName: null,
        isMainActor: isMainActorAnnotated(lines, lineIndex, extensionMatch.groups.modifiers),
        indentation: extensionMatch.groups.indentation.length,
        lineIndex,
      });
    }
  });

  return containers;
}

// A @MainActor base class isolates every test class that inherits from it, so the superclass chain
// is resolved across the whole test target. There is no such base class today; resolving it anyway
// keeps the check honest when one is introduced.
function isMainActorIsolatedClassName(className, testClassesByName) {
  const visitedNames = new Set();
  let currentName = className;

  while (currentName !== null && !visitedNames.has(currentName)) {
    visitedNames.add(currentName);
    const declaration = testClassesByName.get(currentName);

    if (declaration === undefined) {
      return false;
    }

    if (declaration.isMainActor) {
      return true;
    }

    currentName = declaration.superclassName;
  }

  return false;
}

function isMainActorIsolatedContainer(container, testClassesByName) {
  if (container === null) {
    return false;
  }

  if (container.isMainActor) {
    return true;
  }

  const inheritedName = container.kind === "class" ? container.superclassName : container.name;

  return inheritedName === null
    ? false
    : isMainActorIsolatedClassName(inheritedName, testClassesByName);
}

// The innermost declaration that opens before the test function and is indented less than it, which
// skips helper types nested inside the test class.
function findEnclosingContainer(containers, lineIndex, indentation) {
  const enclosingContainers = containers.filter(
    (container) => container.lineIndex < lineIndex && container.indentation < indentation,
  );

  return enclosingContainers.length === 0
    ? null
    : enclosingContainers[enclosingContainers.length - 1];
}

// Every test function in this target closes with a lone `}` at the declaration's own indentation,
// so that line ends the body. Without it the span would run to the next test declaration and, for
// the last test of a file, swallow the sibling helper methods and file-level helper types that
// follow it — helpers that routinely construct @MainActor app types.
function findClosingBraceLineIndex(lines, declarationLineIndex, indentation) {
  for (let lineIndex = declarationLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const leadingWhitespaceLength = line.length - line.trimStart().length;

    if (line.trim() === "}" && leadingWhitespaceLength === indentation) {
      return lineIndex;
    }
  }

  return null;
}

function collectTestFunctions(testFile, testClassesByName) {
  const { filePath, lines, containers } = testFile;
  const declarations = [];

  lines.forEach((line, lineIndex) => {
    const declarationMatch = TEST_FUNCTION_DECLARATION_PATTERN.exec(line);

    if (declarationMatch !== null) {
      declarations.push({
        lineIndex,
        name: declarationMatch.groups.name,
        modifiers: declarationMatch.groups.modifiers,
        indentation: declarationMatch.groups.indentation.length,
      });
    }
  });

  return declarations.map((declaration, declarationIndex) => {
    const nextDeclaration = declarations[declarationIndex + 1];
    const nextDeclarationLineIndex =
      nextDeclaration === undefined ? lines.length : nextDeclaration.lineIndex;
    const closingBraceLineIndex = findClosingBraceLineIndex(
      lines,
      declaration.lineIndex,
      declaration.indentation,
    );
    const bodyEndLineIndex =
      closingBraceLineIndex === null
        ? nextDeclarationLineIndex
        : Math.min(closingBraceLineIndex + 1, nextDeclarationLineIndex);
    const enclosingContainer = findEnclosingContainer(
      containers,
      declaration.lineIndex,
      declaration.indentation,
    );

    return {
      filePath,
      name: declaration.name,
      line: declaration.lineIndex + 1,
      isMainActorIsolated:
        !isExplicitlyNonisolated(declaration.modifiers) &&
        (isMainActorAnnotated(lines, declaration.lineIndex, declaration.modifiers) ||
          isMainActorIsolatedContainer(enclosingContainer, testClassesByName)),
      bodyText: lines.slice(declaration.lineIndex, bodyEndLineIndex).join("\n"),
    };
  });
}

function findReferencedMainActorSymbols(bodyText, mainActorTypeNames, mainActorFunctionNames) {
  const referencedSymbols = new Set();

  for (const [, identifier, delimiter] of bodyText.matchAll(SYMBOL_REFERENCE_PATTERN)) {
    if (mainActorTypeNames.has(identifier)) {
      referencedSymbols.add(identifier);
      continue;
    }

    if (delimiter === "(" && mainActorFunctionNames.has(identifier)) {
      referencedSymbols.add(identifier);
    }
  }

  return [...referencedSymbols].sort();
}

const appSwiftFilePaths = listSwiftFiles(APP_SOURCE_DIR).sort();
const testSwiftFilePaths = listSwiftFiles(TEST_SOURCE_DIR).sort();

// Fail closed: a moved or emptied directory must break the check instead of turning it into a
// silent no-op that reports success on an unscanned tree.
if (appSwiftFilePaths.length === 0) {
  console.error("No iOS app Swift files found.", {
    appSourceDirectory: relative(REPO_ROOT, APP_SOURCE_DIR),
  });
  process.exit(1);
}

if (testSwiftFilePaths.length === 0) {
  console.error("No iOS test Swift files found.", {
    testSourceDirectory: relative(REPO_ROOT, TEST_SOURCE_DIR),
  });
  process.exit(1);
}

const { typeNames: mainActorTypeNames, functionNames: mainActorFunctionNames } =
  collectMainActorAppSymbols(appSwiftFilePaths);

if (mainActorTypeNames.size + mainActorFunctionNames.size === 0) {
  console.error("No @MainActor app symbols found.", {
    appSourceDirectory: relative(REPO_ROOT, APP_SOURCE_DIR),
    appSwiftFiles: appSwiftFilePaths.length,
  });
  process.exit(1);
}

const testFiles = testSwiftFilePaths.map((filePath) => {
  const lines = readSwiftLines(filePath);

  return { filePath, lines, containers: collectContainerDeclarations(lines) };
});
const testClassesByName = new Map(
  testFiles.flatMap(({ containers }) =>
    containers
      .filter((container) => container.kind === "class")
      .map((container) => [container.name, container]),
  ),
);
const testFunctions = testFiles.flatMap((testFile) =>
  collectTestFunctions(testFile, testClassesByName),
);

if (testFunctions.length === 0) {
  console.error("No iOS test functions found.", {
    testSourceDirectory: relative(REPO_ROOT, TEST_SOURCE_DIR),
    testSwiftFiles: testSwiftFilePaths.length,
  });
  process.exit(1);
}

const violations = testFunctions
  .filter((testFunction) => !testFunction.isMainActorIsolated)
  .map((testFunction) => ({
    testFunction,
    mainActorSymbols: findReferencedMainActorSymbols(
      testFunction.bodyText,
      mainActorTypeNames,
      mainActorFunctionNames,
    ),
  }))
  .filter(({ mainActorSymbols }) => mainActorSymbols.length > 0)
  .map(({ testFunction, mainActorSymbols }) => ({
    rule: "nonisolated-test-function-uses-main-actor-symbol",
    file: relative(REPO_ROOT, testFunction.filePath),
    line: testFunction.line,
    testFunction: testFunction.name,
    mainActorSymbols,
    remediation:
      `Annotate ${testFunction.name} with @MainActor, or move it into a @MainActor test ` +
      `class, so it may call ${mainActorSymbols.join(", ")}.`,
  }));

if (violations.length > 0) {
  for (const violation of violations) {
    console.error("iOS test main-actor isolation violation.", violation);
  }

  console.error("iOS test main-actor isolation check failed.", {
    violationCount: violations.length,
    testFunctions: testFunctions.length,
    mainActorTypes: mainActorTypeNames.size,
    mainActorFunctions: mainActorFunctionNames.size,
  });
  process.exit(1);
}

console.log("iOS test main-actor isolation check passed.", {
  appSwiftFiles: appSwiftFilePaths.length,
  testSwiftFiles: testSwiftFilePaths.length,
  testFunctions: testFunctions.length,
  mainActorTypes: mainActorTypeNames.size,
  mainActorFunctions: mainActorFunctionNames.size,
});
