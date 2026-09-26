import { readFileSync } from "node:fs";

const STORE_LOCALES = [
  "en-US", "ar-SA", "zh-Hans", "fr-FR", "de-DE", "hi", "ja", "pt-BR", "ru", "es-MX", "es-ES",
  "bn-BD", "ca", "cs", "da", "el", "fi", "gu-IN", "he", "hr", "hu", "id", "it", "kn-IN", "ko",
  "ml-IN", "mr-IN", "no", "nl-NL", "pa-IN", "pl", "ro", "sk", "sl-SI", "sv", "ta-IN", "te-IN",
  "th", "tr", "uk", "ur-PK", "vi",
] as const;

export type SubscriptionLocalization = { locale: string; name: string; description: string; groupName: string };

function field(section: string, label: string, limit: number, locale: string): string {
  const prefix = `- ${label} (max ${limit}): `;
  const lines = section.split("\n").filter((line) => line.startsWith(prefix));
  const match = lines.length === 1 ? lines[0].slice(prefix.length).match(/^`([^`]+)` \((\d+)\)$/) : null;
  if (match === null) throw new Error(`${locale}: expected one counted ${label} field`);
  const length = Array.from(match[1]).length;
  if (length > limit || length !== Number(match[2])) {
    throw new Error(`${locale}: ${label} has ${length} characters; declared ${match[2]}, limit ${limit}`);
  }
  return match[1];
}

export function loadSubscriptionLocalizations(path: string): SubscriptionLocalization[] {
  const document = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  const sections = [...document.matchAll(/^## App Store Connect texts\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  if (sections.length !== 1) throw new Error(`${path}: expected one App Store Connect texts section`);
  const entries = [...sections[0][1].matchAll(/^### .+ - ([\w-]+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)];
  const locales = entries.map((entry) => entry[1]);
  const missing = STORE_LOCALES.filter((locale) => !locales.includes(locale));
  const unsupported = locales.filter((locale) => !STORE_LOCALES.some((supported) => supported === locale));
  if (missing.length > 0 || unsupported.length > 0 || new Set(locales).size !== locales.length) {
    throw new Error(`Store locale inventory mismatch: ${JSON.stringify({ missing, unsupported, locales })}`);
  }
  return entries.map(([, locale, section]) => ({
    locale, name: field(section, "Display name", 30, locale),
    description: field(section, "Description", 45, locale),
    groupName: field(section, "Subscription group display name", 30, locale),
  }));
}
