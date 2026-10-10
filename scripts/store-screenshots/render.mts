import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  platform: { type: "string", default: "all" }, family: { type: "string", default: "all" },
  locales: { type: "string" }, "input-root": { type: "string" }, "output-root": { type: "string" },
  "chromium-executable": { type: "string" }, "check-layout": { type: "boolean" },
  "verify-existing": { type: "boolean" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log(`Process existing native screenshots; never capture or upload them.
Usage: npm --prefix scripts/store-screenshots run render -- [options]
  --platform all|ios|android          Default: all
  --family all|iphone|ipad            iOS family; default: all
  --locales en-US,ar                  Selected capture tags or listing locale IDs
  --input-root <directory>            Override native input root for one platform
  --output-root <directory>           Override derived output root for one platform
  --chromium-executable <path>        Use an installed browser instead of Playwright Chromium
  --check-layout                     Read-only copy, font and layout validation
  --verify-existing                  Reuse pixel-identical existing iOS outputs
Default inputs: apps/{ios,android}/docs/media/{app-store,play-store}-screenshots
Default outputs: apps/{ios,android}/docs/media/{app-store,play-store}-cards`);
  process.exit(0);
}
if (!["all", "ios", "android"].includes(values.platform!)) throw new Error("--platform must be all, ios, or android.");
if (!["all", "iphone", "ipad"].includes(values.family!)) throw new Error("--family must be all, iphone, or ipad.");
if (values.platform === "android" && values.family !== "all") throw new Error("Android currently has phone captures only; --family is an iOS option.");
if (values.platform === "all" && (values["input-root"] || values["output-root"])) throw new Error("Directory overrides require --platform ios or --platform android.");
const requested = values.locales?.split(",");
if (requested?.some(tag => !tag)) throw new Error("--locales must contain non-empty comma-separated locale identifiers.");
const directory = import.meta.dirname;
const run = (file: string, args: string[]): void => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", resolve(directory, file), ...args], { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} failed (status ${result.status}, signal ${result.signal}). Inspect its error above; raw capture is never run.`);
};
for (const platform of values.platform === "all" ? ["ios", "android"] : [values.platform!]) {
  const args: string[] = [];
  const asset = platform === "ios" ? "app-store" : "google-play";
  if (requested) {
    const copy: Record<string, unknown> = JSON.parse(await readFile(resolve(directory, "assets/localized-copy.json"), "utf8"));
    const locales: Array<{ storeLocale: string; captureTag?: string; capturePrefix?: string; copyTag?: string }> = JSON.parse(await readFile(resolve(directory, `assets/${asset}/store-locales.json`), "utf8"));
    const tags = requested.map(tag => {
      if (platform === "ios" && Object.hasOwn(copy, tag)) return tag;
      const match = locales.find(item => [item.storeLocale, item.captureTag, item.capturePrefix, item.copyTag].includes(tag));
      if (!match) throw new Error(`Unsupported ${platform} locale ${tag}. Available output tags: ${Object.keys(copy).join(", ")}`);
      return platform === "ios" ? match.captureTag! : match.storeLocale;
    });
    args.push("--locales", [...new Set(tags)].join(","));
  }
  for (const option of ["input-root", "output-root", "chromium-executable"] as const) if (values[option]) args.push(`--${option}`, values[option]!);
  if (values["check-layout"]) args.push("--check-layout");
  if (platform === "ios") {
    args.push("--family", values.family!);
    if (values["verify-existing"]) args.push("--verify-existing");
  }
  run(platform === "ios" ? "render-ios.mts" : "render-android.mts", args);
  if (!values["check-layout"]) run(platform === "ios" ? "package-ios.mts" : "package-android.mts", values["output-root"] ? ["--output-root", values["output-root"]] : []);
}
