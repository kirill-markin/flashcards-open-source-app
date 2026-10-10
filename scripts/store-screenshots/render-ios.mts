import { readFile, writeFile, mkdir, readdir, access, mkdtemp, rm, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { requireResolvedSeparation, previousResults, mergeResults } from "./output.mts";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import sharp from "sharp";

type Family = "iphone" | "ipad";
type Copy = Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>;
type Locale = { readonly name: string; readonly storeLocale: string; readonly captureTag: string };
type Bounds = { x: number; y: number; width: number; height: number };
type PlatformFont = { familyName: string; postScriptName: string; isCustomFont: boolean; glyphCount: number };
type Audit = {
  group: Bounds; caption: Bounds; screen: Bounds; frame: Bounds;
  headingStyle: string; captionStyle: string; headingTop: number; captionTop: number;
  captionLines: number; headingLines: number; brand: string; naturalWidth: number; naturalHeight: number;
};
type Result = {
  path: string; family: Family; captureTag: string; storeLocale: string | null; card: number;
  inputRoot: string | null; sourceRevision: string;
  heading: string; caption: string; source: string; sourceSha256: string; sha256: string; width: number; height: number; audit: Audit;
};

const { values } = parseArgs({ options: {
  "input-root": { type: "string" }, "output-root": { type: "string" }, "chromium-executable": { type: "string" },
  "check-layout": { type: "boolean" }, "locales": { type: "string" },
  "verify-existing": { type: "boolean" }, "family": { type: "string", default: "all" },
} });
const repoRoot = resolve(import.meta.dirname, "../..");
const assetRoot = resolve(import.meta.dirname, "assets/app-store");
const inputRoot = resolve(repoRoot, values["input-root"] ?? "apps/ios/docs/media/app-store-screenshots");
const root = resolve(repoRoot, values["output-root"] ?? "apps/ios/docs/media/app-store-cards");
await requireResolvedSeparation(inputRoot, root);
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const copy: Copy = JSON.parse(await readFile(resolve(assetRoot, "../localized-copy.json"), "utf8"));
const locales: ReadonlyArray<Locale> = JSON.parse(await readFile(join(assetRoot, "store-locales.json"), "utf8"));
const order = [4, 1, 2, 3, 5] as const;
const slugs = ["ai-flashcards", "start-learning", "smart-reviews", "your-progress", "your-cards"] as const;
const rtl = new Set(["ar", "he", "fa", "ur"]);
const dimensions: Readonly<Record<Family, readonly [number, number]>> = { iphone: [1284, 2778], ipad: [2064, 2752] };
const selected = values.locales ? new Set(values.locales.split(",")) : null;
const needsIpad = values.family !== "iphone" && Object.keys(copy).some(tag => (!selected || selected.has(tag)) && locales.some(locale => locale.captureTag === tag));
const sourceNames: Readonly<Record<Family, ReadonlyArray<string>>> = {
  iphone: values.family === "ipad" ? [] : await readdir(join(inputRoot, "iphone")),
  ipad: needsIpad ? await readdir(join(inputRoot, "ipad")) : [],
};
const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("\"", "&quot;");
const dataUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString("base64")}`;

const backgrounds: Record<Family, ReadonlyArray<readonly [string, string]>> = { iphone: [], ipad: [] };
for (const family of ["iphone", "ipad"] as const) {
  const assets: Array<readonly [string, string]> = [];
  for (let card = 1; card <= 5; card++) {
    const number = String(card).padStart(2, "0");
    assets.push([
      dataUrl(await readFile(join(assetRoot, `reference/${number}.png`))),
      dataUrl(await readFile(join(assetRoot, `header-background/${number}.png`))),
    ]);
  }
  backgrounds[family] = assets;
}

function html(family: Family, tag: string, card: number, screen: string, frameColor: string): string {
  const [width, height] = dimensions[family];
  const scale = family === "iphone" ? width / 519 : height / 1122;
  const textScale = scale * (family === "ipad" ? 1.35 : 1);
  const frameHeight = 860 * scale;
  const padding = 18 * scale;
  const screenHeight = frameHeight - padding * 2;
  // The tablet frame covers the reference phone completely; the real screen keeps its 3:4 aspect.
  const frameWidth = family === "iphone" ? 418 * scale : 420 * width / 519;
  const paddingInline = family === "iphone" ? padding : (frameWidth - screenHeight * .75) / 2;
  const [base, header] = backgrounds[family][card - 1];
  const [heading, caption] = copy[tag][card - 1];
  const number = String(card).padStart(2, "0");
  const direction = rtl.has(tag) ? "rtl" : "ltr";
  const headingDirection = card === 1 ? "ltr" : direction;
  return `<!doctype html><html lang="${escape(tag)}"><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:#ff7920}
  .card{position:relative;inline-size:${width}px;block-size:${height}px;overflow:hidden;border-radius:${10 * scale}px;color:#101010}
  .background{position:absolute;inset:0;inline-size:100%;block-size:100%}
  .clean{clip-path:inset(0 round ${20 * scale}px);mask-image:linear-gradient(to bottom,#000 0px,#000 ${450 * height / 2778}px,transparent ${510 * height / 2778}px)}
  .heading-row{position:absolute;inset-block-start:${63 * scale}px;inset-inline:0;block-size:${53 * textScale}px;display:flex;align-items:center;justify-content:center}
  .heading{display:inline-flex;direction:${headingDirection};align-items:center;gap:${16 * textScale}px;margin:0;font-family:Arial,sans-serif;font-size:${44 * textScale}px;font-weight:700;line-height:${53 * textScale}px;letter-spacing:0;white-space:nowrap}
  .number{display:flex;flex:0 0 auto;direction:ltr;align-items:center;justify-content:center;inline-size:${50 * textScale}px;block-size:${30 * textScale}px;border-radius:${15 * textScale}px;background:#000;color:#fff;font-family:Arial,sans-serif;font-size:${20 * textScale}px;font-weight:400;line-height:1}
  .caption{position:absolute;inset-block-start:${141 * scale}px;inset-inline:0;margin:0;font-family:Arial,sans-serif;font-size:${24 * textScale}px;font-weight:400;line-height:${28 * textScale}px;letter-spacing:0;text-align:center;white-space:nowrap;direction:${direction}}
  .frame{position:absolute;inset-block-start:${212 * scale}px;inset-inline-start:${(width - frameWidth) / 2}px;inline-size:${frameWidth}px;block-size:${frameHeight}px;padding-block:${padding}px;padding-inline:${paddingInline}px;background:${frameColor};border-radius:${51 * scale}px}
  .screen-box{inline-size:100%;block-size:100%;background:#000;overflow:hidden;border-radius:${33 * scale}px;display:flex;align-items:center;justify-content:center}
  .screen{display:block;block-size:100%;inline-size:auto;max-inline-size:100%;object-fit:contain}
  </style><article class="card"><img class="background" src="${base}"><img class="background clean" src="${header}">
  <div class="heading-row"><h1 class="heading"><span class="number">${number}.</span><span class="heading-text" dir="${headingDirection}">${escape(heading)}</span></h1></div>
  <p class="caption"><span>${escape(caption)}</span></p><div class="frame"><div class="screen-box"><img class="screen" src="${screen}"></div></div></article></html>`;
}

const previous = await previousResults<Result>(join(root, "export-manifest.json"));
const browser = await chromium.launch({ executablePath: values["chromium-executable"], headless: true });
let staging: string | null = null;
const results: Result[] = [];
const overflows: Array<{ tag: string; family: Family; card: number; heading: string; caption: string; reason: string }> = [];
try {
  if (!values["check-layout"]) staging = await mkdtemp(join(tmpdir(), "nibomo-store-cards-"));
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route("**/*", route => route.abort());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const fontAudit: Array<{ tag: string; family: Family; card: number; fonts: ReadonlyArray<PlatformFont> }> = [];
  for (const tag of Object.keys(copy)) {
    if (selected && !selected.has(tag)) continue;
    const locale = locales.find(item => item.captureTag === tag);
    if (!locale && values.family === "ipad") {
      if (selected) throw new Error(`No iPad capture is configured for iPhone-only language ${tag}. Select --family iphone.`);
      continue;
    }
    if (copy[tag].length !== 5 || copy[tag][0][0] !== "Nibomo App") throw new Error(`Invalid copy set: ${tag}`);
    for (const family of ((locale ? ["iphone", "ipad"] : ["iphone"]) as Family[]).filter(family => values.family === "all" || values.family === family)) {
      const [width, height] = dimensions[family];
      await page.setViewportSize({ width, height });
      const group = locale ? "ready" : "additional-languages";

      const typography: Array<readonly [string, string, number, number]> = [];
      for (let card = 1; card <= 5; card++) {
        const names = sourceNames[family].filter(name => name.startsWith(`${tag}-${order[card - 1]}_`) && name.endsWith(".png"));
        if (names.length !== 1) throw new Error(`Expected one source for ${family}/${tag}/${card}; found ${names.length}`);
        const source = `${family}/${names[0]}`;
        const raw = await readFile(join(inputRoot, source));
        const original = await sharp(raw).metadata();
        if (original.width !== width || original.height !== height) throw new Error(`Wrong source dimensions: ${source}`);
        const reference = await sharp(join(assetRoot, `reference/${String(card).padStart(2, "0")}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const offset = (500 * reference.info.width + 51) * 3;
        const frameColor = `rgb(${reference.data[offset]},${reference.data[offset + 1]},${reference.data[offset + 2]})`;
        await page.setContent(html(family, tag, card, dataUrl(raw), frameColor), { waitUntil: "load" });
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, img => img.decode())); });
        const audit: Audit = await page.evaluate(() => {
          const bound = (element: Element): Bounds => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const textBounds = (selector: string): Bounds => { const range = document.createRange(); range.selectNodeContents(document.querySelector(selector)!); const r = range.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
          const style = (selector: string): string => { const s = getComputedStyle(document.querySelector(selector)!); return `${s.fontFamily};${s.fontSize};${s.fontWeight};${s.lineHeight}`; };
          const image = document.querySelector<HTMLImageElement>(".screen")!;
          const captionRange = document.createRange(); captionRange.selectNodeContents(document.querySelector(".caption span")!);
          const titleRange = document.createRange(); titleRange.selectNodeContents(document.querySelector(".heading-text")!);
          const lines = (range: Range): number => {
            const rects = Array.from(range.getClientRects()).sort((a, b) => a.top - b.top);
            return rects.reduce((state, rect) => rect.top < state.bottom
              ? { count: state.count, bottom: Math.max(state.bottom, rect.bottom) }
              : { count: state.count + 1, bottom: rect.bottom }, { count: 0, bottom: -Infinity }).count;
          };
          return { group: bound(document.querySelector(".heading")!), caption: textBounds(".caption span"), screen: bound(image), frame: bound(document.querySelector(".frame")!),
            headingStyle: style(".heading"), captionStyle: style(".caption"), headingTop: bound(document.querySelector(".heading-row")!).y,
            captionTop: bound(document.querySelector(".caption")!).y, captionLines: lines(captionRange), headingLines: lines(titleRange),
            brand: document.querySelector(".heading-text")!.textContent!, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
        });
        const reasons: string[] = [];
        if (Math.abs(audit.group.x + audit.group.width / 2 - width / 2) > .1) reasons.push("Heading group is off center");
        if (Math.abs(audit.caption.x + audit.caption.width / 2 - width / 2) > .1) reasons.push("Caption is off center");
        if (audit.group.x < 50 || audit.group.x + audit.group.width > width - 50) reasons.push(`Heading exceeds safe margins: ${audit.group.width.toFixed(1)}px`);
        if (audit.caption.x < 50 || audit.caption.x + audit.caption.width > width - 50) reasons.push(`Caption exceeds safe margins: ${audit.caption.width.toFixed(1)}px`);
        if (audit.caption.y + audit.caption.height >= audit.frame.y) reasons.push("Caption overlaps device");
        if (audit.headingLines !== 1 || audit.captionLines !== 1) reasons.push("Text wraps");
        if (Math.abs(audit.screen.width / audit.screen.height - width / height) > .001) reasons.push("Screen is stretched");
        if (audit.screen.y < audit.frame.y || audit.screen.y + audit.screen.height > audit.frame.y + audit.frame.height || audit.frame.y + audit.frame.height > height - 50) reasons.push("Device is cropped");
        typography.push([audit.headingStyle, audit.captionStyle, audit.headingTop, audit.captionTop]);
        if (typography.some(styles => JSON.stringify(styles) !== JSON.stringify(typography[0]))) reasons.push("Inconsistent typography within set");
        if (reasons.length) {
          overflows.push({ tag, family, card, heading: copy[tag][card - 1][0], caption: copy[tag][card - 1][1], reason: reasons.join("; ") });
          if (!values["check-layout"]) throw new Error(`${family}/${tag}/${card}: ${reasons.join("; ")}`);
        }
        if (card === 2) {
          const doc = await cdp.send("DOM.getDocument");
          const node = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: ".heading-text" });
          const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: node.nodeId });
          if (fonts.fonts.some(font => /LastResort/i.test(font.familyName + font.postScriptName))) {
            throw new Error(`Missing script glyphs in heading: ${tag}`);
          }
          fontAudit.push({ tag, family, card, fonts: fonts.fonts });
        }
        if (values["check-layout"]) continue;
        const path = `${group}/${family}/${tag}-${card}_${slugs[card - 1]}.png`;
        const png = await page.screenshot({ animations: "disabled" });
        const rendered = sharp(png).flatten({ background: "#ff7920" }).toColourspace("srgb");
        const exists = await access(join(root, path)).then(() => true, () => false);
        let opaque: Buffer;
        if (values["verify-existing"] && exists) {
          const previous = await readFile(join(root, path));
          const [previousPixels, currentPixels] = await Promise.all([
            sharp(previous).removeAlpha().raw().toBuffer(), rendered.clone().removeAlpha().raw().toBuffer(),
          ]);
          opaque = previousPixels.equals(currentPixels) ? previous : await rendered.png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
        } else {
          opaque = await rendered.png({ compressionLevel: 6, adaptiveFiltering: true }).toBuffer();
        }
        const metadata = await sharp(opaque).metadata();
        if (metadata.width !== width || metadata.height !== height || metadata.hasAlpha) throw new Error(`Invalid output PNG: ${family}/${tag}/${card}`);
        await mkdir(dirname(join(staging!, path)), { recursive: true });
        await writeFile(join(staging!, path), opaque);
        results.push({ path, family, captureTag: tag, storeLocale: locale?.storeLocale ?? null, card, inputRoot, sourceRevision,
          heading: copy[tag][card - 1][0], caption: copy[tag][card - 1][1], source, sourceSha256: createHash("sha256").update(raw).digest("hex"), width, height,
          sha256: createHash("sha256").update(opaque).digest("hex"), audit });
      }
    }
    console.log(`${values["check-layout"] ? "Layout checked" : "Exported"}: ${tag} (${values.family === "all" ? locale ? "iPhone + iPad" : "iPhone; no Store locale" : values.family})`);
  }
  if (values["check-layout"]) {

    console.log(JSON.stringify({ overflows }, null, 2));
    if (overflows.length) process.exitCode = 1;
  } else {
    if (!results.length) throw new Error("No selected iOS capture sets match this family. iPhone-only languages cannot produce iPad cards.");
    for (const file of results) {
      await mkdir(dirname(join(root, file.path)), { recursive: true });
      await copyFile(join(staging!, file.path), join(root, file.path));
    }
    await writeFile(join(root, "export-manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sourceRevision, inputRoot, results: mergeResults(previous, results), fontAudit, overflows }, null, 2) + "\n");
    console.log(`Verified and exported ${results.length} opaque PNGs.`);
  }
} finally {
  await browser.close();
  if (staging) await rm(staging, { recursive: true, force: true });
}
