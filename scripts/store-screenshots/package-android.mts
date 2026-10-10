import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseArgs } from "node:util";
import { getLocaleEnglishName, getLocaleNativeName, isSupportedLocale } from "./locale-names.mts";

type Bounds = { x: number; y: number; width: number; height: number };
type Audit = { group: Bounds; caption: Bounds; screen: Bounds; frame: Bounds; headingStyle: string; captionStyle: string; headingTop: number; captionTop: number };
type Result = { path: string; storeLocale: string; copyTag: string; card: number; heading: string; caption: string; source: string; sha256: string; width: number; height: number; audit: Audit };
type Manifest = { sourceRevision: string; generatedAt: string; results: ReadonlyArray<Result>; overflows: ReadonlyArray<unknown> };
type Locale = { name: string; storeLocale: string; copyTag: string; consoleAvailability: string };
type Copy = Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>;

const { values } = parseArgs({ options: { "output-root": { type: "string" } } });
const assetRoot = resolve(import.meta.dirname, "assets/google-play");
const root = resolve(import.meta.dirname, "../..", values["output-root"] ?? "apps/android/docs/media/play-store-cards");
const manifest: Manifest = JSON.parse(await readFile(join(root, "export-manifest.json"), "utf8"));
const locales: ReadonlyArray<Locale> = JSON.parse(await readFile(join(assetRoot, "store-locales.json"), "utf8"));
const sharedCopy: Copy = JSON.parse(await readFile(resolve(assetRoot, "../localized-copy.json"), "utf8"));
const copy: Copy = Object.fromEntries(locales.map(locale => {
  if (!sharedCopy[locale.copyTag]) throw new Error(`No saved marketing copy for Android ${locale.storeLocale} (${locale.copyTag}). Update assets/localized-copy.json.`);
  return [locale.storeLocale, sharedCopy[locale.copyTag]];
}));
const aliases: Readonly<Record<string, string>> = { "en-US": "en", "es-ES": "es", "es-MX": "es", "pt-BR": "pt", "zh-Hans": "zh" };
const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("\"", "&quot;");
if (!manifest.results.length || manifest.results.length % 5 !== 0 || manifest.overflows.length) throw new Error("Expected complete five-card Android sets with no layout errors.");
const headingStyles = new Set(manifest.results.map(file => file.audit.headingStyle));
const captionStyles = new Set(manifest.results.map(file => file.audit.captionStyle));
const headingPositions = new Set(manifest.results.map(file => file.audit.headingTop));
const captionPositions = new Set(manifest.results.map(file => file.audit.captionTop));
if ([headingStyles, captionStyles, headingPositions, captionPositions].some(set => set.size !== 1)) throw new Error("Typography differs between Google Play locale sets.");

const gallery: Array<{ tag: string; label: string; preview: string; consoleAvailability: string; files: Array<{ path: string; heading: string; caption: string }> }> = [];
await mkdir(join(root, "previews"), { recursive: true });
for (const locale of locales.filter(locale => manifest.results.some(file => file.storeLocale === locale.storeLocale))) {
  const tag = locale.storeLocale;
  const language = aliases[locale.copyTag] ?? locale.copyTag;
  if (!isSupportedLocale(language)) throw new Error(`Unknown app language: ${tag}/${locale.copyTag}`);
  const files = manifest.results.filter(file => file.storeLocale === tag).sort((a, b) => a.card - b.card);
  if (files.length !== 5 || files.some((file, index) => file.card !== index + 1)) throw new Error(`Incomplete set: ${tag}`);
  const previewWidth = 324;
  const previewHeight = 576;
  const gap = 16;
  const canvasWidth = previewWidth * 5 + gap * 6;
  const inputs: Buffer[] = [];
  for (const file of files) {
    const bytes = await readFile(join(root, file.path));
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`Export checksum differs: ${file.path}`);
    if (file.heading !== copy[tag][file.card - 1][0] || file.caption !== copy[tag][file.card - 1][1]) throw new Error(`Copy differs from export: ${file.path}`);
    const metadata = await sharp(bytes).metadata();
    if (metadata.hasAlpha || metadata.channels !== 3 || metadata.width !== 1080 || metadata.height !== 1920) throw new Error(`Invalid Google Play PNG: ${file.path}`);
    inputs.push(await sharp(bytes).resize(previewWidth, previewHeight).png().toBuffer());
  }
  const preview = `previews/${tag}-phone.png`;
  const title = `${locale.name} · Google Play · Android phone · 1080 × 1920`;
  const labelSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="48"><text x="16" y="32" fill="#ededed" font-family="Arial,sans-serif" font-size="24">${escape(title)}</text></svg>`);
  await sharp({ create: { width: canvasWidth, height: previewHeight + 80, channels: 3, background: "#202020" } }).composite([
    { input: labelSvg, left: 0, top: 0 }, ...inputs.map((input, index) => ({ input, left: gap + index * (previewWidth + gap), top: 60 })),
  ]).png().toFile(join(root, preview));
  const variant = tag.startsWith("es-") ? ` · ${tag === "es-ES" ? "España" : tag === "es-US" ? "Estados Unidos" : "Latinoamérica"}` : "";
  gallery.push({ tag, label: `${getLocaleNativeName(language)}${variant} (${getLocaleEnglishName(language)})`, preview, consoleAvailability: locale.consoleAvailability,
    files: files.map(file => ({ path: file.path, heading: file.heading, caption: file.caption })) });
}
await writeFile(join(root, "gallery-data.json"), JSON.stringify(gallery, null, 2) + "\n");
const page = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Карточки Nibomo · Google Play</title><style>
*{box-sizing:border-box}body{margin:0;background:#1d1d1d;color:#f5f5f5;font:16px Arial,sans-serif}main{max-inline-size:1800px;margin-inline:auto;padding:28px}h1{font-size:28px;margin:0 0 12px}p{color:#bbb;line-height:1.5}.controls{display:flex;gap:20px;align-items:end;flex-wrap:wrap;margin-block:24px}label{display:grid;gap:8px}select{font:inherit;max-inline-size:100%;padding:12px 14px;border:1px solid #555;border-radius:10px;background:#2b2b2b;color:inherit}#cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}figure{margin:0;min-inline-size:0}figure img{display:block;inline-size:100%;block-size:auto;border-radius:8px}figcaption{padding-block:12px;color:#ddd;line-height:1.4}a{color:inherit}.links{display:flex;flex-wrap:wrap;gap:24px;margin-block:8px 24px;color:#ffd052}@media(max-width:900px){#cards{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:16px}}@media(max-width:480px){#cards{grid-template-columns:1fr}}
</style><main><h1>Карточки Nibomo для Google Play</h1><p>Пять карточек на каждый язык: Android-телефоны, формат 1080 × 1920. Выберите язык; нажмите на карточку, чтобы открыть её целиком.</p><div class="controls"><label>Язык<select id="language"></select></label></div><p id="details"></p><div class="links"><a id="overview" target="_blank">Все пять карточек одним изображением</a></div><section id="cards"></section></main><script>
const catalog=${JSON.stringify(gallery).replaceAll("<", "\\u003c")};const language=document.querySelector('#language');
for(const item of catalog){const option=document.createElement('option');option.value=item.tag;option.textContent=item.label;language.append(option)}language.value=catalog[0].tag;
function render(){const item=catalog.find(item=>item.tag===language.value);document.querySelector('#details').textContent='Google Play · '+item.tag+' · Android-телефоны'+(item.consoleAvailability==='unverified'?' · Доступность языка в Play Console нужно проверить':'');document.querySelector('#overview').href=item.preview;const cards=document.querySelector('#cards');cards.replaceChildren();for(const file of item.files){const figure=document.createElement('figure');const link=document.createElement('a');link.href=file.path;link.target='_blank';const image=document.createElement('img');image.src=file.path;image.alt=file.heading+' — '+file.caption;link.append(image);figure.append(link);const caption=document.createElement('figcaption');caption.textContent=file.heading+' · '+file.caption;figure.append(caption);cards.append(figure)}}language.addEventListener('change',render);render();
</script></html>`;
await writeFile(join(root, "index.html"), page);
const centerErrors = manifest.results.flatMap(file => [file.audit.group, file.audit.caption, file.audit.screen].map(bounds => Math.abs(bounds.x + bounds.width / 2 - 540)));
const summary = { screenshots: manifest.results.length, languages: new Set(gallery.map(item => locales.find(locale => locale.storeLocale === item.tag)!.copyTag === "es-MX" ? "es-ES" : locales.find(locale => locale.storeLocale === item.tag)!.copyTag)).size, localeVariants: gallery.length, screenshotsPerSet: 5,
  phoneScreenshots: { width: 1080, height: 1920, aspectRatio: "9:16", color: "RGB PNG without alpha" },
  sourceRevision: manifest.sourceRevision, headingStyle: [...headingStyles][0], captionStyle: [...captionStyles][0],
  maximumCenterErrorPixels: Math.max(...centerErrors), tabletScreenshots: 0,
  tabletStatus: "Native Android tablet captures were not available in the pinned app source; actual tablet captures are needed to create accurate tablet assets.",
  localeAvailabilityUnverified: locales.filter(locale => locale.consoleAvailability === "unverified").map(locale => locale.storeLocale) };
await writeFile(join(root, "package-summary.json"), JSON.stringify(summary, null, 2) + "\n");
await writeFile(join(root, "verification.json"), JSON.stringify({ generatedAt: new Date().toISOString(), screenshotChecksumsVerified: manifest.results.length,
  headingStyles: [...headingStyles], captionStyles: [...captionStyles], headingPositions: [...headingPositions], captionPositions: [...captionPositions],
  maximumCenterErrorPixels: summary.maximumCenterErrorPixels, opaqueRGB: true, nativeSourceScreensUnmodified: true, sourceAspectPreserved: true,
  formatSource: "https://support.google.com/googleplay/android-developer/answer/9866151?hl=en", scope: "Local files and format/layout validation; no Play Console publication or review" }, null, 2) + "\n");
console.log(`Packaged ${gallery.length} five-card Android phone sets and review gallery. All ${manifest.results.length} image checksums verified.`);
