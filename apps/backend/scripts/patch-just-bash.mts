import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// just-bash indents the model's Python into a `try:` block, which shifts the contents of multi-line
// strings; drop this patch once https://github.com/vercel-labs/just-bash/issues/727 ships.
const userScriptPath = "/lib/_jb_main.py";
const replacements: ReadonlyArray<readonly [string, string]> = [
  [
    '${input.pythonCode.split("\\n").map((line) => `    ${line}`).join("\\n")}\n',
    [
      `    with open("${userScriptPath}", "rb") as _jb_main_file:`,
      `        _jb_main_code = compile(_jb_main_file.read(), "${userScriptPath}", "exec")`,
      "    exec(_jb_main_code, globals())",
      "",
    ].join("\n"),
  ],
  [
    "  const scriptData = encoder.encode(wrappedCode);\n  Module.FS.writeFile(scriptPath, scriptData);\n",
    [
      "  Module.FS.writeFile(scriptPath, encoder.encode(wrappedCode));",
      `  Module.FS.writeFile("${userScriptPath}", encoder.encode(input.pythonCode));`,
      "",
    ].join("\n"),
  ],
];

function countOccurrences(text: string, search: string): number {
  return text.split(search).length - 1;
}

const [nodeModulesDir] = process.argv.slice(2);
if (nodeModulesDir === undefined) {
  throw new Error("Patching just-bash requires the node_modules directory that contains it");
}

// The python3 worker that `import("just-bash")` loads; a repeated run leaves it unchanged.
const packageDir = join(nodeModulesDir, "just-bash");
const { version } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { readonly version: string };
const workerPath = join(packageDir, "dist", "bundle", "chunks", "worker.js");
const source = readFileSync(workerPath, "utf8");
const patched = replacements.reduce((text, [original, replacement]) => {
  const originalCount = countOccurrences(text, original);
  const replacementCount = countOccurrences(text, replacement);
  if (originalCount === 0 && replacementCount === 1) return text;
  if (originalCount !== 1 || replacementCount !== 0) {
    throw new Error(
      `Cannot patch just-bash ${version} at ${workerPath}: expected the original text once, found it `
      + `${originalCount} times and the patched text ${replacementCount} times. Update `
      + "apps/backend/scripts/patch-just-bash.mts for this version, or delete it if upstream fixed the bug.\n"
      + `Original text: ${JSON.stringify(original)}`,
    );
  }
  return text.replace(original, () => replacement);
}, source);
if (patched !== source) writeFileSync(workerPath, patched);
