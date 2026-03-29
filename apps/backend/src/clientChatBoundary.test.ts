import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const legacyTurnPath = "/chat" + "/turn";
const legacyDiagnosticsPath = legacyTurnPath + "/diagnostics";

type ClientBoundaryCheck = Readonly<{
  directory: string;
  forbiddenPatterns: ReadonlyArray<string>;
}>;

const clientBoundaryChecks: ReadonlyArray<ClientBoundaryCheck> = [
  {
    directory: path.join(repoRoot, "apps/web/src"),
    forbiddenPatterns: [
      legacyTurnPath,
      legacyDiagnosticsPath,
      "selectedModelId",
      "codeInterpreterContainerId",
      "AIChatTurnRequestBody",
      "AiChatTurnRequest",
      "streamTurn(",
    ],
  },
  {
    directory: path.join(repoRoot, "apps/ios/Flashcards/Flashcards"),
    forbiddenPatterns: [
      legacyTurnPath,
      legacyDiagnosticsPath,
      "selectedModelId",
      "codeInterpreterContainerId",
      "AIChatTurnRequestBody",
      "AiChatTurnRequest",
      "streamTurn(",
    ],
  },
  {
    directory: path.join(repoRoot, "apps/ios/Flashcards/FlashcardsTests"),
    forbiddenPatterns: [
      legacyTurnPath,
      legacyDiagnosticsPath,
      "selectedModelId",
      "codeInterpreterContainerId",
      "AIChatTurnRequestBody",
      "AiChatTurnRequest",
      "streamTurn(",
    ],
  },
  {
    directory: path.join(repoRoot, "apps/android"),
    forbiddenPatterns: [
      legacyTurnPath,
      legacyDiagnosticsPath,
      "selectedModelId",
      "codeInterpreterContainerId",
      "AIChatTurnRequestBody",
      "AiChatTurnRequest",
      "streamTurn(",
    ],
  },
];

function collectFiles(directory: string): ReadonlyArray<string> {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const entryStats = statSync(fullPath);
    if (entryStats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (/\.(ts|tsx|swift|kt)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

for (const check of clientBoundaryChecks) {
  test(`client chat boundary stays legacy-free in ${path.relative(repoRoot, check.directory)}`, () => {
    const files = collectFiles(check.directory);

    for (const filePath of files) {
      const source = readFileSync(filePath, "utf8");
      for (const forbiddenPattern of check.forbiddenPatterns) {
        assert.equal(
          source.includes(forbiddenPattern),
          false,
          `${path.relative(repoRoot, filePath)} unexpectedly contains ${forbiddenPattern}`,
        );
      }
    }
  });
}
