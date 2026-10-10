import assert from "node:assert/strict";
import { readFile, writeFile, readdir, mkdtemp, mkdir, copyFile, rm, symlink } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";

type File = { path: string; inputRoot: string; sourceRevision: string; source: string; sourceSha256: string; sha256: string; width: number; height: number; card: number; heading: string; caption: string; family?: string; captureTag?: string; storeLocale: string | null };
type Manifest = { inputRoot: string; sourceRevision: string; results: File[] };
type GalleryFile = { path: string; heading: string; caption: string };
type IosGallery = Array<{ tag: string; sets: Array<{ family: string; files: GalleryFile[] }> }>;
type AndroidGallery = Array<{ tag: string; files: GalleryFile[] }>;
const { values } = parseArgs({ options: { "chromium-executable": { type: "string" } } });
const repoRoot = resolve(import.meta.dirname, "../..");
const iosInput = resolve(repoRoot, "apps/ios/docs/media/app-store-screenshots");
const androidInput = resolve(repoRoot, "apps/android/docs/media/play-store-screenshots");
const temporary = await mkdtemp(join(tmpdir(), "nibomo-store-smoke-"));
const iosOutput = join(temporary, "ios");
const androidOutput = join(temporary, "android");
const browserArgs = values["chromium-executable"] ? ["--chromium-executable", values["chromium-executable"]] : [];
const hash = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function invoke(args: string[], expectedSuccess = true): string {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", resolve(import.meta.dirname, "render.mts"), ...args, ...browserArgs], { cwd: repoRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, shell: false });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  assert.equal(result.status === 0, expectedSuccess, `Unexpected command result (${result.status}): ${args.join(" ")}\n${output}`);
  return output;
}

async function sourceSnapshot(): Promise<Record<string, string>> {
  const paths = [
    ...(await readdir(join(iosInput, "iphone"))).filter(name => name.endsWith(".png")).map(name => join(iosInput, "iphone", name)),
    ...(await readdir(join(iosInput, "ipad"))).filter(name => name.endsWith(".png")).map(name => join(iosInput, "ipad", name)),
    ...(await readdir(androidInput)).filter(name => name.endsWith(".png")).map(name => join(androidInput, name)),
  ];
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(path))])));
}

async function verifyExports(root: string, expectedCount: number, platform: "ios" | "android"): Promise<Manifest> {
  const manifest: Manifest = JSON.parse(await readFile(join(root, "export-manifest.json"), "utf8"));
  assert.equal(manifest.results.length, expectedCount);
  for (const file of manifest.results) {
    const bytes = await readFile(join(root, file.path));
    assert.equal(hash(bytes), file.sha256);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, file.width);
    assert.equal(metadata.height, file.height);
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.hasAlpha, false);
    if (file.card === 1) assert.equal(file.heading, "Nibomo App");
    const source = resolve(repoRoot, file.inputRoot, platform === "ios" ? file.source : file.source.split("/").at(-1)!);
    assert.equal(hash(await readFile(source)), file.sourceSha256);
  }
  return manifest;
}

async function verifyGallery(root: string, platform: "ios" | "android", expectedLanguages: number): Promise<void> {
  let html = await readFile(join(root, "index.html"), "utf8");
  const data = JSON.parse(await readFile(join(root, "gallery-data.json"), "utf8")) as IosGallery | AndroidGallery;
  const files = platform === "ios" ? (data as IosGallery).flatMap(item => item.sets.flatMap(set => set.files)) : (data as AndroidGallery).flatMap(item => item.files);
  for (const file of files) {
    const bytes = await sharp(join(root, file.path)).resize({ height: 500 }).png().toBuffer();
    html = html.replaceAll(file.path, `data:image/png;base64,${bytes.toString("base64")}`);
  }
  const browser = await chromium.launch({ executablePath: values["chromium-executable"], headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    const loaded = async (): Promise<void> => {
      await page.evaluate(async () => { await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#cards img"), image => image.decode())); });
      assert.equal(await page.locator("#cards img").count(), 5);
    };
    assert.equal(await page.locator("#language option").count(), expectedLanguages);
    await loaded();
    await page.selectOption("#language", "ar");
    await loaded();
    if (platform === "ios") {
      await page.selectOption("#device", "ipad");
      await loaded();
      if (expectedLanguages === 3) {
        await page.selectOption("#language", "ru");
        assert.equal(await page.inputValue("#device"), "ipad");
        assert.equal(await page.locator('#device option[value="iphone"]').evaluate(option => (option as HTMLOptionElement).disabled), true);
        await loaded();
      }
    }
  } finally { await browser.close(); }
}

try {
  const originalSources = await sourceSnapshot();
  console.log("Smoke: process real English/Arabic iPhone and iPad captures.");
  invoke(["--platform", "ios", "--locales", "en-US,ar", "--output-root", iosOutput]);
  const initialIos = await verifyExports(iosOutput, 20, "ios");
  assert.equal(initialIos.inputRoot, iosInput);
  assert.ok(initialIos.results.every(file => file.inputRoot === iosInput && file.sourceRevision === initialIos.sourceRevision));
  await verifyGallery(iosOutput, "ios", 2);

  console.log("Smoke: process real English/Arabic Android captures.");
  invoke(["--platform", "android", "--locales", "en-US,ar", "--output-root", androidOutput]);
  const initialAndroid = await verifyExports(androidOutput, 10, "android");
  assert.equal(initialAndroid.inputRoot, androidInput);
  assert.ok(initialAndroid.results.every(file => file.inputRoot === androidInput && file.sourceRevision === initialAndroid.sourceRevision));
  await verifyGallery(androidOutput, "android", 2);

  console.log("Smoke: add one iPad-only locale from a relative input override and retain previous provenance.");
  const alternateIos = join(temporary, "ios-native");
  await symlink(iosInput, alternateIos, "dir");
  await writeFile(join(iosOutput, "export-manifest.json"), JSON.stringify({ ...initialIos,
    results: initialIos.results.map(({ inputRoot, sourceRevision, ...file }) => file) }));
  invoke(["--platform", "ios", "--family", "ipad", "--locales", "ru", "--input-root", relative(repoRoot, alternateIos), "--output-root", iosOutput]);
  const retained = await verifyExports(iosOutput, 25, "ios");
  assert.equal(retained.inputRoot, alternateIos);
  assert.deepEqual(retained.results.filter(file => file.captureTag !== "ru"), initialIos.results);
  assert.ok(retained.results.filter(file => file.captureTag === "ru").every(file => file.inputRoot === alternateIos));
  assert.equal(retained.results.filter(file => file.captureTag === "ru").length, 5);
  await verifyGallery(iosOutput, "ios", 3);

  console.log("Smoke: replace one Android locale from an absolute input override and retain previous provenance.");
  const alternateAndroid = join(temporary, "android-native");
  await symlink(androidInput, alternateAndroid, "dir");
  invoke(["--platform", "android", "--locales", "en-US", "--input-root", alternateAndroid, "--output-root", androidOutput]);
  const retainedAndroid = await verifyExports(androidOutput, 10, "android");
  assert.equal(retainedAndroid.inputRoot, alternateAndroid);
  assert.deepEqual(retainedAndroid.results.filter(file => file.storeLocale === "ar"), initialAndroid.results.filter(file => file.storeLocale === "ar"));
  assert.ok(retainedAndroid.results.filter(file => file.storeLocale === "en-US").every(file => file.inputRoot === alternateAndroid));
  await verifyGallery(androidOutput, "android", 2);

  console.log("Smoke: a late missing input must not change previously exported cards.");
  const invalidInput = join(temporary, "incomplete-native");
  await mkdir(join(invalidInput, "iphone"), { recursive: true });
  const inputNames = (await readdir(join(iosInput, "iphone"))).filter(name => /^en-US-[1-4]_/.test(name));
  assert.equal(inputNames.length, 4);
  for (const name of inputNames) await copyFile(join(iosInput, "iphone", name), join(invalidInput, "iphone", name));
  const beforeManifest = await readFile(join(iosOutput, "export-manifest.json"));
  const failure = invoke(["--platform", "ios", "--family", "iphone", "--locales", "en-US", "--input-root", invalidInput, "--output-root", iosOutput], false);
  assert.match(failure, /Expected one source/);
  assert.deepEqual(await readFile(join(iosOutput, "export-manifest.json")), beforeManifest);
  await verifyExports(iosOutput, 25, "ios");

  console.log("Smoke: raw-input writes and symlink aliases must be rejected.");
  assert.match(invoke(["--platform", "ios", "--family", "iphone", "--locales", "en-US", "--output-root", iosInput], false), /must be separate/);
  const rawAlias = join(temporary, "raw-symlink");
  await symlink(iosInput, rawAlias, "dir");
  assert.match(invoke(["--platform", "ios", "--family", "iphone", "--locales", "en-US", "--output-root", rawAlias], false), /must be separate/);
  assert.match(invoke(["--platform", "ios", "--locales", "not-a-configured-locale"], false), /Unsupported ios locale/);

  console.log("Smoke: check-layout must be read-only.");
  const readOnlyOutput = join(temporary, "read-only-output");
  invoke(["--platform", "ios", "--family", "ipad", "--locales", "en-US", "--output-root", readOnlyOutput, "--check-layout"]);
  await assert.rejects(readFile(join(readOnlyOutput, "export-manifest.json")), { code: "ENOENT" });
  assert.deepEqual(await sourceSnapshot(), originalSources, "The native screenshot inventory changed during processing.");
  console.log(`Store processor smoke passed: real PNG exports and galleries, incremental device sets, failure preservation, read-only validation, and all ${Object.keys(originalSources).length} native files unchanged.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
