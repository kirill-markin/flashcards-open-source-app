import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseArgs } from "node:util";
import { getLocaleEnglishName, getLocaleNativeName, isSupportedLocale } from "./locale-names.mts";

type Result = { path: string; family: "iphone" | "ipad"; captureTag: string; storeLocale: string | null; card: number; heading: string; caption: string; sha256: string; width: number; height: number };
type Manifest = { sourceRevision: string; generatedAt: string; results: ReadonlyArray<Result> };
const { values } = parseArgs({ options: { "output-root": { type: "string" } } });
const assetRoot = resolve(import.meta.dirname, "assets/app-store");
const root = resolve(import.meta.dirname, "../..", values["output-root"] ?? "apps/ios/docs/media/app-store-cards");
const manifest: Manifest = JSON.parse(await readFile(join(root, "export-manifest.json"), "utf8"));
const copy: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = JSON.parse(await readFile(resolve(assetRoot, "../localized-copy.json"), "utf8"));
const aliases: Readonly<Record<string, string>> = { "en-US": "en", "es-ES": "es", "es-MX": "es", "pt-BR": "pt", "zh-Hans": "zh" };
const escape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll("\"", "&quot;");
const tags = [...new Set(manifest.results.map(file => file.captureTag))];
if (!manifest.results.length || manifest.results.length % 5 !== 0) throw new Error("Expected complete five-card iOS sets.");
const gallery: Array<{ tag: string; label: string; storeLocale: string | null; sets: Array<{ family: string; preview: string; files: Array<{ path: string; heading: string; caption: string }> }> }> = [];
await mkdir(join(root, "previews"), { recursive: true });
for (const tag of tags) {
  const locale = aliases[tag] ?? tag;
  if (!isSupportedLocale(locale)) throw new Error(`Unknown website locale for captured tag: ${tag}`);
  const region = tag === "es-MX" ? " · México" : tag === "es-ES" ? " · España" : "";
  const label = `${getLocaleNativeName(locale)}${region} (${getLocaleEnglishName(locale)})`;
  const item: (typeof gallery)[number] = { tag, label, storeLocale: manifest.results.find(result => result.captureTag === tag)!.storeLocale, sets: [] };
  for (const family of ["iphone", "ipad"] as const) {
    const files = manifest.results.filter(result => result.captureTag === tag && result.family === family).sort((a, b) => a.card - b.card);
    if (!files.length) continue;
    if (files.length !== 5) throw new Error(`Incomplete set: ${tag}/${family}`);
    const height = 580;
    const width = Math.round(height * files[0].width / files[0].height);
    const gap = 16;
    const canvasWidth = width * 5 + gap * 6;
    const inputs: Buffer[] = [];
    for (const file of files) {
      const bytes = await readFile(join(root, file.path));
      if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`Export checksum differs: ${file.path}`);
      if (file.heading !== copy[tag][file.card - 1][0] || file.caption !== copy[tag][file.card - 1][1]) throw new Error(`Copy differs from rendered export: ${file.path}`);
      const metadata = await sharp(bytes).metadata();
      if (metadata.hasAlpha || metadata.width !== file.width || metadata.height !== file.height) throw new Error(`Invalid output PNG: ${file.path}`);
      inputs.push(await sharp(bytes).resize(width, height).png().toBuffer());
    }
    const title = `${getLocaleEnglishName(locale)}${tag === "es-MX" ? " (Mexico)" : tag === "es-ES" ? " (Spain)" : ""} · ${family === "iphone" ? "iPhone" : "iPad"}`;
    const labelSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="48"><text x="16" y="32" fill="#ededed" font-family="Arial,sans-serif" font-size="24">${escape(title)}</text></svg>`);
    const preview = `previews/${tag}-${family}.png`;
    await sharp({ create: { width: canvasWidth, height: height + 80, channels: 3, background: "#202020" } }).composite([
      { input: labelSvg, left: 0, top: 0 }, ...inputs.map((input, index) => ({ input, left: gap + index * (width + gap), top: 60 })),
    ]).png().toFile(join(root, preview));
    item.sets.push({ family, preview, files: files.map(file => ({ path: file.path, heading: file.heading, caption: file.caption })) });
  }
  gallery.push(item);
}
await writeFile(join(root, "gallery-data.json"), JSON.stringify(gallery, null, 2) + "\n");
const page = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Карточки Nibomo · App Store</title><style>
*{box-sizing:border-box}body{margin:0;background:#1d1d1d;color:#f5f5f5;font:16px Arial,sans-serif}main{max-inline-size:1800px;margin-inline:auto;padding:28px}h1{font-size:28px;margin:0 0 12px}p{color:#bbb;line-height:1.5}.controls{display:flex;gap:20px;align-items:end;flex-wrap:wrap;margin-block:24px}label{display:grid;gap:8px}select{font:inherit;max-inline-size:100%;padding:12px 14px;border:1px solid #555;border-radius:10px;background:#2b2b2b;color:inherit}#cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}figure{margin:0;min-inline-size:0}figure img{display:block;inline-size:100%;block-size:auto;border-radius:8px}figcaption{padding-block:12px;color:#ddd;line-height:1.4}a{color:inherit}#overview{display:inline-block;margin-block:8px 24px;color:#ffd052}@media(max-width:900px){#cards{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:16px}}@media(max-width:480px){#cards{grid-template-columns:1fr}}
</style><main><h1>Карточки Nibomo для App Store</h1><p>Пять карточек на каждый язык и устройство. Выберите набор; нажмите на карточку, чтобы открыть её целиком.</p><div class="controls"><label>Язык<select id="language"></select></label><label>Устройство<select id="device"><option value="iphone">iPhone</option><option value="ipad">iPad</option></select></label></div><p id="details"></p><a id="overview" target="_blank">Открыть все пять карточек одним изображением</a><section id="cards"></section></main><script>
const catalog=${JSON.stringify(gallery).replaceAll("<", "\\u003c")};
const language=document.querySelector('#language');const device=document.querySelector('#device');
for(const item of catalog){const option=document.createElement('option');option.value=item.tag;option.textContent=item.label;language.append(option)}language.value=catalog[0].tag;
function render(){const item=catalog.find(item=>item.tag===language.value);for(const option of device.options)option.disabled=!item.sets.some(set=>set.family===option.value);if(!item.sets.some(set=>set.family===device.value))device.value=item.sets[0].family;const set=item.sets.find(set=>set.family===device.value);document.querySelector('#details').textContent=item.storeLocale?'App Store · '+item.storeLocale+' · '+(device.value==='iphone'?'iPhone':'iPad'):'Дополнительный язык приложения: у Apple нет отдельной локализации App Store.';document.querySelector('#overview').href=set.preview;const cards=document.querySelector('#cards');cards.replaceChildren();for(const file of set.files){const figure=document.createElement('figure');const link=document.createElement('a');link.href=file.path;link.target='_blank';const image=document.createElement('img');image.src=file.path;image.alt=file.heading+' — '+file.caption;link.append(image);figure.append(link);const caption=document.createElement('figcaption');caption.textContent=file.heading+' · '+file.caption;figure.append(caption);cards.append(figure)}}language.addEventListener('change',render);device.addEventListener('change',render);render();
</script></html>`;
await writeFile(join(root, "index.html"), page);
const summary = { images: manifest.results.length, appStoreImages: manifest.results.filter(file => file.storeLocale).length, additionalImages: manifest.results.filter(file => !file.storeLocale).length, languages: new Set(tags.map(tag => aliases[tag] ?? tag)).size, captureTags: tags.length, storeLocalizations: new Set(manifest.results.filter(file => file.storeLocale).map(file => file.storeLocale)).size,
  sets: gallery.reduce((count, item) => count + item.sets.length, 0), sourceRevision: manifest.sourceRevision,
  families: { iphone: { width: 1284, height: 2778, storeImages: manifest.results.filter(file => file.family === "iphone" && file.storeLocale).length }, ipad: { width: 2064, height: 2752, storeImages: manifest.results.filter(file => file.family === "ipad" && file.storeLocale).length } },
  excludedStoreLocales: tags.filter(tag => !manifest.results.find(file => file.captureTag === tag)!.storeLocale), screenshotsPerSet: 5 };
await writeFile(join(root, "package-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`Packaged review gallery with ${summary.sets} five-card sets; all ${manifest.results.length} checksums and copy pairs verified.`);
