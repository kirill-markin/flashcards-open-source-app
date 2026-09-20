import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// App Store Connect language inventory; screenshot tags match the capture wrappers.
const LOCALES: ReadonlyArray<readonly [string, string, string]> = [
  ["English (U.S.)", "en-US", "en-US"], ["Arabic", "ar-SA", "ar"],
  ["Chinese (Simplified)", "zh-Hans", "zh-Hans"], ["French", "fr-FR", "fr"],
  ["German", "de-DE", "de"], ["Hindi", "hi", "hi"], ["Japanese", "ja", "ja"],
  ["Portuguese (Brazil)", "pt-BR", "pt-BR"], ["Russian", "ru", "ru"],
  ["Spanish (Mexico)", "es-MX", "es-MX"], ["Spanish (Spain)", "es-ES", "es-ES"],
  ["Bangla", "bn-BD", "bn"], ["Catalan", "ca", "ca"], ["Czech", "cs", "cs"],
  ["Danish", "da", "da"], ["Greek", "el", "el"], ["Finnish", "fi", "fi"],
  ["Gujarati", "gu-IN", "gu"], ["Hebrew", "he", "he"], ["Croatian", "hr", "hr"],
  ["Hungarian", "hu", "hu"], ["Indonesian", "id", "id"], ["Italian", "it", "it"],
  ["Kannada", "kn-IN", "kn"], ["Korean", "ko", "ko"], ["Malayalam", "ml-IN", "ml"],
  ["Marathi", "mr-IN", "mr"], ["Norwegian", "no", "nb"], ["Dutch", "nl-NL", "nl"],
  ["Punjabi", "pa-IN", "pa"], ["Polish", "pl", "pl"], ["Romanian", "ro", "ro"],
  ["Slovak", "sk", "sk"], ["Slovenian", "sl-SI", "sl"], ["Swedish", "sv", "sv"],
  ["Tamil", "ta-IN", "ta"], ["Telugu", "te-IN", "te"], ["Thai", "th", "th"],
  ["Turkish", "tr", "tr"], ["Ukrainian", "uk", "uk"], ["Urdu", "ur-PK", "ur"],
  ["Vietnamese", "vi", "vi"],
];

export type Screenshot = { path: string; fileName: string; fileSize: number; checksum: string };
export type ScreenshotSet = { displayType: string; files: Screenshot[]; screenshotLocale: string };
export type Localization = {
  locale: string;
  info: { name: string; subtitle: string };
  version: { description: string; keywords: string; whatsNew: string };
  screenshots: ScreenshotSet[];
};

function field(section: string, heading: string, limit: number, locale: string): string {
  const matches = [...section.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
    .filter((match) => match[1] === heading);
  if (matches.length !== 1) throw new Error(`${locale}: expected exactly one ${heading} field`);
  const value = matches[0][2].trim();
  const length = Array.from(value).length;
  if (length === 0 || length > limit) throw new Error(`${locale}: ${heading} has ${length} characters; expected 1–${limit}`);
  return value;
}

function screenshot(path: string, fileName: string, family: string): Screenshot {
  const bytes = readFileSync(path);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error(`Invalid PNG: ${path}`);
  const size = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  const sizes = family === "iphone" ? ["1284x2778"] : ["2064x2752", "2048x2732"];
  if (!sizes.includes(size)) throw new Error(`${path}: unsupported ${family} dimensions ${size}; expected ${sizes.join(" or ")}`);
  if (![0, 2, 3].includes(bytes[25])) throw new Error(`${path}: App Store screenshots must not contain an alpha channel`);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) throw new Error(`Truncated PNG: ${path}`);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "tRNS") throw new Error(`${path}: PNG transparency is not allowed`);
    offset += length + 12;
  }
  if (offset !== bytes.length) throw new Error(`Invalid PNG chunk boundary: ${path}`);
  return { path, fileName, fileSize: bytes.length, checksum: createHash("md5").update(bytes).digest("hex") };
}

export function loadLocalizations(metadataPath: string, screenshotsPath: string): Localization[] {
  const document = readFileSync(metadataPath, "utf8").replaceAll("\r\n", "\n");
  const sections = [...document.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  if (sections.length !== LOCALES.length) throw new Error(`Expected ${LOCALES.length} locale sections in ${metadataPath}; found ${sections.length}`);
  return LOCALES.map(([heading, locale, screenshotLocale]) => {
    const matches = sections.filter((section) => section[1] === heading);
    if (matches.length !== 1) throw new Error(`Expected exactly one ${heading} section in ${metadataPath}`);
    const section = matches[0][2];
    const declaredLocale = section.match(/^App Store locale: `([^`]+)`$/m)?.[1];
    if (declaredLocale !== undefined && declaredLocale !== locale) throw new Error(`${heading}: expected App Store locale ${locale}, got ${declaredLocale}`);
    return {
      locale,
      info: { name: field(section, "Name", 30, locale), subtitle: field(section, "Subtitle", 30, locale) },
      version: {
        description: field(section, "Description", 4000, locale),
        keywords: field(section, "Keywords", 100, locale),
        whatsNew: field(section, "What's New", 4000, locale),
      },
      screenshots: ["iphone", "ipad"].map((family) => {
        const directory = join(screenshotsPath, family);
        const names = readdirSync(directory);
        const files = [1, 2, 3, 4, 5].map((index) => {
          const namesForIndex = names.filter((name) => name.startsWith(`${screenshotLocale}-${index}_`) && name.endsWith(".png"));
          if (namesForIndex.length !== 1) throw new Error(`${directory}: expected one ${screenshotLocale}-${index}_*.png; found ${namesForIndex.length}`);
          return screenshot(join(directory, namesForIndex[0]), namesForIndex[0], family);
        });
        return { displayType: family === "iphone" ? "APP_IPHONE_65" : "APP_IPAD_PRO_3GEN_129", files, screenshotLocale };
      }),
    };
  });
}
