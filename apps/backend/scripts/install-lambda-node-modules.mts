import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// Native packages such as sharp install their binary for the ARM64 Lambda, whatever host bundles it.
execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund", "--os=linux", "--cpu=arm64", "--libc=glibc"], {
  cwd: outputDir,
  stdio: "inherit",
});

// Lambda caps unzipped code plus layers at 250 MiB, and nothing reads the installed packages' source
// maps at runtime. Sentry uses the bundle's own index.js.map, which sits outside node_modules.
const nodeModulesDir = join(outputDir, "node_modules");
for (const entry of readdirSync(nodeModulesDir, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".map")) rmSync(join(entry.parentPath, entry.name));
}
