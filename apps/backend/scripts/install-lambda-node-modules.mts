import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PackageManifest {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly overrides: Readonly<Record<string, string | Readonly<Record<string, string>>>>;
  readonly allowScripts: Readonly<Record<string, boolean>>;
}

const [inputDir, outputDir, ...modules] = process.argv.slice(2);
if (inputDir === undefined || outputDir === undefined || modules.length === 0) {
  throw new Error("Lambda module installation requires input/output directories and dependency names");
}

const manifest = JSON.parse(readFileSync(join(inputDir, "package.json"), "utf8")) as PackageManifest;
const dependencies = Object.fromEntries(modules.map((name) => {
  const version = manifest.dependencies[name];
  if (typeof version !== "string") {
    throw new Error(`Lambda module ${name} is absent from ${inputDir}/package.json dependencies`);
  }
  return [name, version];
}));
writeFileSync(join(outputDir, "package.json"), JSON.stringify({
  dependencies,
  overrides: manifest.overrides,
  allowScripts: manifest.allowScripts,
}));
copyFileSync(join(inputDir, "package-lock.json"), join(outputDir, "package-lock.json"));
execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: outputDir,
  stdio: "inherit",
});
