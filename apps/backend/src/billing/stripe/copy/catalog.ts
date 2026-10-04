import { StripeBillingError } from "../contracts";
import copyar from "./locales/ar.json";
import copybg from "./locales/bg.json";
import copybn from "./locales/bn.json";
import copyca from "./locales/ca.json";
import copycs from "./locales/cs.json";
import copyda from "./locales/da.json";
import copyde from "./locales/de.json";
import copyel from "./locales/el.json";
import copyen from "./locales/en.json";
import copyes_ES from "./locales/es-ES.json";
import copyes_MX from "./locales/es-MX.json";
import copyet from "./locales/et.json";
import copyfa from "./locales/fa.json";
import copyfi from "./locales/fi.json";
import copyfr from "./locales/fr.json";
import copygu from "./locales/gu.json";
import copyhe from "./locales/he.json";
import copyhi from "./locales/hi.json";
import copyhr from "./locales/hr.json";
import copyhu from "./locales/hu.json";
import copyid from "./locales/id.json";
import copyis from "./locales/is.json";
import copyit from "./locales/it.json";
import copyja from "./locales/ja.json";
import copykn from "./locales/kn.json";
import copyko from "./locales/ko.json";
import copylt from "./locales/lt.json";
import copylv from "./locales/lv.json";
import copyml from "./locales/ml.json";
import copymr from "./locales/mr.json";
import copynb from "./locales/nb.json";
import copynl from "./locales/nl.json";
import copypa from "./locales/pa.json";
import copypl from "./locales/pl.json";
import copypt_BR from "./locales/pt-BR.json";
import copyro from "./locales/ro.json";
import copyru from "./locales/ru.json";
import copysk from "./locales/sk.json";
import copysl from "./locales/sl.json";
import copysv from "./locales/sv.json";
import copysw from "./locales/sw.json";
import copyta from "./locales/ta.json";
import copyte from "./locales/te.json";
import copyth from "./locales/th.json";
import copytr from "./locales/tr.json";
import copyuk from "./locales/uk.json";
import copyur from "./locales/ur.json";
import copyvi from "./locales/vi.json";
import copyzh_Hans from "./locales/zh-Hans.json";
import copyzu from "./locales/zu.json";

type StripeCopy = Readonly<typeof copyen>;
const copies: Readonly<Record<string, StripeCopy>> = {
  "ar": copyar, "bg": copybg, "bn": copybn, "ca": copyca, "cs": copycs,
  "da": copyda, "de": copyde, "el": copyel, "en": copyen, "es-ES": copyes_ES,
  "es-MX": copyes_MX, "et": copyet, "fa": copyfa, "fi": copyfi, "fr": copyfr,
  "gu": copygu, "he": copyhe, "hi": copyhi, "hr": copyhr, "hu": copyhu,
  "id": copyid, "is": copyis, "it": copyit, "ja": copyja, "kn": copykn,
  "ko": copyko, "lt": copylt, "lv": copylv, "ml": copyml, "mr": copymr,
  "nb": copynb, "nl": copynl, "pa": copypa, "pl": copypl, "pt-BR": copypt_BR,
  "ro": copyro, "ru": copyru, "sk": copysk, "sl": copysl, "sv": copysv,
  "sw": copysw, "ta": copyta, "te": copyte, "th": copyth, "tr": copytr,
  "uk": copyuk, "ur": copyur, "vi": copyvi, "zh-Hans": copyzh_Hans, "zu": copyzu,
};

// CLDR's es-419 children: Latin America and the United States.
const latinAmericanSpanishRegions = new Set(["419", "AR", "BO", "BR", "BZ", "CL", "CO", "CR", "CU", "DO",
  "EC", "GT", "HN", "MX", "NI", "PA", "PE", "PR", "PY", "SV", "US", "UY", "VE"]);
const languageCopyLocales: Readonly<Record<string, string>> = {
  zh: "zh-Hans", pt: "pt-BR", no: "nb", nn: "nb", iw: "he", in: "id",
};

/** Maps any stored profile tag (an app interface language) to the Stripe copy locale serving it. */
export function resolveStripeCopyLocale(profileLocale: string): string {
  if (Object.hasOwn(copies, profileLocale)) return profileLocale;
  let tag: Intl.Locale;
  try {
    tag = new Intl.Locale(profileLocale);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new Error(`Stored profile locale is not a BCP 47 language tag: ${JSON.stringify(profileLocale)}`);
  }
  if (tag.language === "es") {
    return tag.region !== undefined && latinAmericanSpanishRegions.has(tag.region) ? "es-MX" : "es-ES";
  }
  if (Object.hasOwn(languageCopyLocales, tag.language)) return languageCopyLocales[tag.language];
  return Object.hasOwn(copies, tag.language) ? tag.language : "en";
}

export function stripeEmailCopy(locale: string): StripeCopy {
  const copy = copies[locale];
  if (copy === undefined) throw new StripeBillingError("STRIPE_EMAIL_DATA_INVALID", false,
    "Billing email requires a supported persisted Nibomo locale.");
  return copy;
}
