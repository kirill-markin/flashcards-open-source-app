import type Stripe from "stripe";
import copyar from "./copy/locales/ar.json";
import copybg from "./copy/locales/bg.json";
import copybn from "./copy/locales/bn.json";
import copyca from "./copy/locales/ca.json";
import copycs from "./copy/locales/cs.json";
import copyda from "./copy/locales/da.json";
import copyde from "./copy/locales/de.json";
import copyel from "./copy/locales/el.json";
import copyen from "./copy/locales/en.json";
import copyes_ES from "./copy/locales/es-ES.json";
import copyes_MX from "./copy/locales/es-MX.json";
import copyet from "./copy/locales/et.json";
import copyfa from "./copy/locales/fa.json";
import copyfi from "./copy/locales/fi.json";
import copyfr from "./copy/locales/fr.json";
import copygu from "./copy/locales/gu.json";
import copyhe from "./copy/locales/he.json";
import copyhi from "./copy/locales/hi.json";
import copyhr from "./copy/locales/hr.json";
import copyhu from "./copy/locales/hu.json";
import copyid from "./copy/locales/id.json";
import copyis from "./copy/locales/is.json";
import copyit from "./copy/locales/it.json";
import copyja from "./copy/locales/ja.json";
import copykn from "./copy/locales/kn.json";
import copyko from "./copy/locales/ko.json";
import copylt from "./copy/locales/lt.json";
import copylv from "./copy/locales/lv.json";
import copyml from "./copy/locales/ml.json";
import copymr from "./copy/locales/mr.json";
import copynb from "./copy/locales/nb.json";
import copynl from "./copy/locales/nl.json";
import copypa from "./copy/locales/pa.json";
import copypl from "./copy/locales/pl.json";
import copypt_BR from "./copy/locales/pt-BR.json";
import copyro from "./copy/locales/ro.json";
import copyru from "./copy/locales/ru.json";
import copysk from "./copy/locales/sk.json";
import copysl from "./copy/locales/sl.json";
import copysv from "./copy/locales/sv.json";
import copysw from "./copy/locales/sw.json";
import copyta from "./copy/locales/ta.json";
import copyte from "./copy/locales/te.json";
import copyth from "./copy/locales/th.json";
import copytr from "./copy/locales/tr.json";
import copyuk from "./copy/locales/uk.json";
import copyur from "./copy/locales/ur.json";
import copyvi from "./copy/locales/vi.json";
import copyzh_Hans from "./copy/locales/zh-Hans.json";
import copyzu from "./copy/locales/zu.json";

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
const hostedLocales = new Set(["bg", "cs", "da", "de", "el", "en", "et", "fi", "fr", "hr",
  "hu", "id", "it", "ja", "ko", "lt", "lv", "nb", "nl", "pl", "pt-BR", "ro", "ru", "sk",
  "sl", "sv", "th", "tr", "vi"]);

export function stripeHostedLocale(locale: string): Stripe.Checkout.SessionCreateParams.Locale {
  if (locale === "es-ES") return "es";
  if (locale === "es-MX") return "es-419";
  if (locale === "zh-Hans") return "zh";
  return hostedLocales.has(locale) ? locale : "en";
}

export function stripeCheckoutCustomText(
  locale: Stripe.Checkout.SessionCreateParams.Locale,
): Stripe.Checkout.SessionCreateParams.CustomText {
  const canonical = locale === "es" ? "es-ES" : locale === "es-419" ? "es-MX"
    : locale === "zh" ? "zh-Hans" : locale;
  const copy = copies[canonical];
  if (copy === undefined) throw new Error("Checkout requires a server-mapped Nibomo locale.");
  return { submit: { message: [copy["offer.renewalDisclosure"], copy["offer.taxDisclosure"],
    `[${copy["legal.terms"]}](https://nibomo.com/terms/)`,
    `[${copy["legal.privacy"]}](https://nibomo.com/privacy/)`].join(" ") } };
}
