import { readFile, writeFile, mkdir, readdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { requireResolvedSeparation, previousResults, mergeResults } from "./output.mts";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import sharp from "sharp";

type Copy = Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>;
type Locale = { readonly name: string; readonly storeLocale: string; readonly capturePrefix: string; readonly copyTag: string; readonly consoleAvailability: string };
type Bounds = { x: number; y: number; width: number; height: number };
type PlatformFont = { familyName: string; postScriptName: string; isCustomFont: boolean; glyphCount: number };
type Audit = {
  group: Bounds; caption: Bounds; screen: Bounds; frame: Bounds;
  headingStyle: string; captionStyle: string; headingTop: number; captionTop: number;
  captionLines: number; headingLines: number; brand: string; naturalWidth: number; naturalHeight: number;
};
type Result = {
  path: string; imageType: "phoneScreenshots"; storeLocale: string; capturePrefix: string; copyTag: string; card: number;
  heading: string; caption: string; source: string; sourceSha256: string; sha256: string; width: number; height: number; audit: Audit;
};

const { values } = parseArgs({ options: {
  "input-root": { type: "string" }, "output-root": { type: "string" }, "chromium-executable": { type: "string" },
  "check-layout": { type: "boolean" }, "locales": { type: "string" },
} });
const repoRoot = resolve(import.meta.dirname, "../..");
const assetRoot = resolve(import.meta.dirname, "assets/google-play");
const inputRoot = resolve(repoRoot, values["input-root"] ?? "apps/android/docs/media/play-store-screenshots");
const root = resolve(repoRoot, values["output-root"] ?? "apps/android/docs/media/play-store-cards");
await requireResolvedSeparation(inputRoot, root);
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const sharedCopy: Copy = JSON.parse(await readFile(resolve(assetRoot, "../localized-copy.json"), "utf8"));
const locales: ReadonlyArray<Locale> = JSON.parse(await readFile(join(assetRoot, "store-locales.json"), "utf8"));
const copy: Copy = Object.fromEntries(locales.map(locale => {
  if (!sharedCopy[locale.copyTag]) throw new Error(`No saved marketing copy for Android ${locale.storeLocale} (${locale.copyTag}). Update assets/localized-copy.json.`);
  return [locale.storeLocale, sharedCopy[locale.copyTag]];
}));
const names = await readdir(inputRoot);
const order = [4, 1, 2, 3, 5] as const;
const slugs = ["ai-flashcards", "start-learning", "smart-reviews", "your-progress", "your-cards"] as const;
const rtl = new Set(["ar", "he", "fa", "ur"]);
const width = 1080;
const height = 1920;
const textScale = width / 519;
const screenHeight = 1450;
const screenWidth = screenHeight * 1080 / 2400;
const padding = 30;
const selected = values.locales ? new Set(values.locales.split(",")) : null;
const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("\"", "&quot;");
const dataUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString("base64")}`;
const backgrounds: string[] = [];
const frameColors: string[] = [];
for (let card = 1; card <= 5; card++) {
  const number = String(card).padStart(2, "0");
  backgrounds.push(dataUrl(await readFile(join(assetRoot, `background/${number}.png`))));
  const reference = await sharp(resolve(assetRoot, `../app-store/reference/${number}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (500 * reference.info.width + 51) * 3;
  frameColors.push(`rgb(${reference.data[offset]},${reference.data[offset + 1]},${reference.data[offset + 2]})`);
}

function html(locale: Locale, card: number, screen: string): string {
  const [heading, caption] = copy[locale.storeLocale][card - 1];
  const number = String(card).padStart(2, "0");
  const direction = rtl.has(locale.copyTag) ? "rtl" : "ltr";
  const headingDirection = card === 1 ? "ltr" : direction;
  const frameWidth = screenWidth + padding * 2;
  const frameHeight = screenHeight + padding * 2;
  return `<!doctype html><html lang="${escape(locale.storeLocale)}"><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:#ff7920}
  .card{position:relative;inline-size:${width}px;block-size:${height}px;overflow:hidden;color:#101010}
  .background{position:absolute;inset:0;inline-size:100%;block-size:100%}
  .heading-row{position:absolute;inset-block-start:110px;inset-inline:0;block-size:${53 * textScale}px;display:flex;align-items:center;justify-content:center}
  .heading{display:inline-flex;direction:${headingDirection};align-items:center;gap:${16 * textScale}px;margin:0;font-family:Arial,sans-serif;font-size:${44 * textScale}px;font-weight:700;line-height:${53 * textScale}px;letter-spacing:0;white-space:nowrap}
  .number{display:flex;flex:0 0 auto;direction:ltr;align-items:center;justify-content:center;inline-size:${50 * textScale}px;block-size:${30 * textScale}px;border-radius:${15 * textScale}px;background:#000;color:#fff;font-family:Arial,sans-serif;font-size:${20 * textScale}px;font-weight:400;line-height:1}
  .caption{position:absolute;inset-block-start:260px;inset-inline:0;margin:0;font-family:Arial,sans-serif;font-size:${24 * textScale}px;font-weight:400;line-height:${28 * textScale}px;letter-spacing:0;text-align:center;white-space:nowrap;direction:${direction}}
  .frame{position:absolute;inset-block-start:370px;inset-inline-start:${(width - frameWidth) / 2}px;inline-size:${frameWidth}px;block-size:${frameHeight}px;padding:${padding}px;background:${frameColors[card - 1]};border-radius:70px}
  .screen{display:block;inline-size:${screenWidth}px;block-size:${screenHeight}px;object-fit:contain}
  </style><article class="card"><img class="background" src="${backgrounds[card - 1]}">
  <div class="heading-row"><h1 class="heading"><span class="number">${number}.</span><span class="heading-text" dir="${headingDirection}">${escape(heading)}</span></h1></div>
  <p class="caption"><span>${escape(caption)}</span></p><div class="frame"><img class="screen" src="${screen}"></div></article></html>`;
}

const previous = await previousResults<Result>(join(root, "export-manifest.json"));
const browser = await chromium.launch({ executablePath: values["chromium-executable"], headless: true });
let staging: string | null = null;
const results: Result[] = [];
const overflows: Array<{ locale: string; card: number; reason: string }> = [];
try {
  if (!values["check-layout"]) staging = await mkdtemp(join(tmpdir(), "nibomo-store-cards-"));
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setViewportSize({ width, height });
  await page.route("**/*", route => route.abort());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const fontAudit: Array<{ locale: string; card: number; fonts: ReadonlyArray<PlatformFont> }> = [];
  for (const locale of locales) {
    if (selected && !selected.has(locale.storeLocale)) continue;
    const tag = locale.storeLocale;
    if (copy[tag].length !== 5 || copy[tag][0][0] !== "Nibomo App") throw new Error(`Invalid copy set: ${tag}`);

    const typography: Array<readonly [string, string, number, number]> = [];
    for (let card = 1; card <= 5; card++) {
      const matches = names.filter(name => name.startsWith(`${locale.capturePrefix}-${order[card - 1]}_`) && name.endsWith(".png"));
      if (matches.length !== 1) throw new Error(`Expected one native Android source for ${tag}/${card}; found ${matches.length}`);
      const source = `play-store-screenshots/${matches[0]}`;
      const raw = await readFile(join(inputRoot, matches[0]));
      const original = await sharp(raw).metadata();
      if (original.width !== 1080 || original.height !== 2400) throw new Error(`Wrong native Android source dimensions: ${source}`);
      await page.setContent(html(locale, card, dataUrl(raw)), { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, img => img.decode())); });
      const audit: Audit = await page.evaluate(() => {
        const bound = (element: Element): Bounds => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const textBounds = (selector: string): Bounds => { const range = document.createRange(); range.selectNodeContents(document.querySelector(selector)!); const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const style = (selector: string): string => { const s = getComputedStyle(document.querySelector(selector)!); return `${s.fontFamily};${s.fontSize};${s.fontWeight};${s.lineHeight}`; };
        const image = document.querySelector<HTMLImageElement>(".screen")!;
        const lines = (selector: string): number => {
          const range = document.createRange(); range.selectNodeContents(document.querySelector(selector)!);
          const rects = Array.from(range.getClientRects()).sort((a, b) => a.top - b.top);
          return rects.reduce((state, rect) => rect.top < state.bottom
            ? { count: state.count, bottom: Math.max(state.bottom, rect.bottom) }
            : { count: state.count + 1, bottom: rect.bottom }, { count: 0, bottom: -Infinity }).count;
        };
        return { group: bound(document.querySelector(".heading")!), caption: textBounds(".caption span"), screen: bound(image), frame: bound(document.querySelector(".frame")!),
          headingStyle: style(".heading"), captionStyle: style(".caption"), headingTop: bound(document.querySelector(".heading-row")!).y,
          captionTop: bound(document.querySelector(".caption")!).y, captionLines: lines(".caption span"), headingLines: lines(".heading-text"),
          brand: document.querySelector(".heading-text")!.textContent!, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
      });
      const reasons: string[] = [];
      if (Math.abs(audit.group.x + audit.group.width / 2 - width / 2) > .1) reasons.push("Heading group is off center");
      if (Math.abs(audit.caption.x + audit.caption.width / 2 - width / 2) > .1) reasons.push("Caption is off center");
      if (audit.group.x < 40 || audit.group.x + audit.group.width > width - 40) reasons.push("Heading exceeds safe margins");
      if (audit.caption.x < 40 || audit.caption.x + audit.caption.width > width - 40) reasons.push("Caption exceeds safe margins");
      if (audit.caption.y + audit.caption.height >= audit.frame.y) reasons.push("Caption overlaps screen");
      if (audit.captionTop + 28 * textScale > height * .2) reasons.push("Marketing header exceeds 20% of canvas height");
      if (audit.headingLines !== 1 || audit.captionLines !== 1) reasons.push("Text wraps");
      if (Math.abs(audit.screen.width / audit.screen.height - 1080 / 2400) > .0001) reasons.push("Native screen is stretched");
      if (audit.screen.y < audit.frame.y || audit.screen.y + audit.screen.height > audit.frame.y + audit.frame.height || audit.frame.y + audit.frame.height > height - 35) reasons.push("Native screen or frame is cropped");
      if (Math.abs(audit.screen.x + audit.screen.width / 2 - width / 2) > .1) reasons.push("Native screen is off center");
      typography.push([audit.headingStyle, audit.captionStyle, audit.headingTop, audit.captionTop]);
      if (typography.some(styles => JSON.stringify(styles) !== JSON.stringify(typography[0]))) reasons.push("Inconsistent typography within set");
      if (reasons.length) {
        overflows.push({ locale: tag, card, reason: reasons.join("; ") });
        if (!values["check-layout"]) throw new Error(`${tag}/${card}: ${reasons.join("; ")}`);
      }
      if (card === 2) {
        const doc = await cdp.send("DOM.getDocument");
        const node = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: ".heading-text" });
        const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
        if (fonts.fonts.some(font => /LastResort/i.test(font.familyName + font.postScriptName))) throw new Error(`Missing script glyphs: ${tag}`);
        fontAudit.push({ locale: tag, card, fonts: fonts.fonts });
      }
      if (values["check-layout"]) continue;
      const path = `ready/${tag}/phoneScreenshots/${String(card).padStart(2, "0")}_${slugs[card - 1]}.png`;
      const png = await page.screenshot({ animations: "disabled" });
      const opaque = await sharp(png).flatten({ background: "#ff7920" }).toColourspace("srgb").png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
      const metadata = await sharp(opaque).metadata();
      if (metadata.width !== width || metadata.height !== height || metadata.hasAlpha || metadata.channels !== 3) throw new Error(`Invalid Google Play RGB PNG: ${tag}/${card}`);
      await mkdir(dirname(join(staging!, path)), { recursive: true });
      await writeFile(join(staging!, path), opaque);
      results.push({ path, imageType: "phoneScreenshots", storeLocale: tag, capturePrefix: locale.capturePrefix, copyTag: locale.copyTag, card,
        heading: copy[tag][card - 1][0], caption: copy[tag][card - 1][1], source, sourceSha256: createHash("sha256").update(raw).digest("hex"), width, height,
        sha256: createHash("sha256").update(opaque).digest("hex"), audit });
    }
    console.log(`${values["check-layout"] ? "Layout checked" : "Exported"}: ${tag} (native Android phone)`);
  }
  if (!values["check-layout"]) {
    if (!results.length) throw new Error("No Android capture sets selected. Pass a configured Play listing locale.");
    for (const file of results) {
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await copyFile(join(staging!, file.path), join(root, file.path));
    }
    await writeFile(join(root, "export-manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sourceRevision, inputRoot: "apps/android/docs/media/play-store-screenshots", results: mergeResults(previous, results), fontAudit, overflows }, null, 2) + "\n");
  }
  console.log(`Verified ${values["check-layout"] ? "layout" : `${results.length} opaque 1080 × 1920 PNGs`}; ${overflows.length} layout errors.`);
  if (overflows.length) process.exitCode = 1;
} finally {
  await browser.close();
  if (staging) await rm(staging, { recursive: true, force: true });
}
