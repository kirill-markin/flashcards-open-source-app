import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const names: Readonly<Record<string, { english: string; native: string }>> = JSON.parse(await readFile(resolve(import.meta.dirname, "assets/locale-names.json"), "utf8"));
export function isSupportedLocale(locale: string): boolean { return Object.hasOwn(names, locale); }
export function getLocaleEnglishName(locale: string): string {
  if (!isSupportedLocale(locale)) throw new Error(`No gallery language label for ${locale}. Update assets/locale-names.json.`);
  return names[locale].english;
}
export function getLocaleNativeName(locale: string): string {
  if (!isSupportedLocale(locale)) throw new Error(`No gallery language label for ${locale}. Update assets/locale-names.json.`);
  return names[locale].native;
}
