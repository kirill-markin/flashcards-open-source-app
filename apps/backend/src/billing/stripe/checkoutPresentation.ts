import type Stripe from "stripe";
import { getStripeCopy } from "./copy/catalog";

const hostedLocales = new Set(["bg", "cs", "da", "de", "el", "en", "en-GB", "et", "fi", "fr", "fr-CA", "hr",
  "hu", "id", "it", "ja", "ko", "lt", "lv", "ms", "nb", "nl", "pl", "pt-BR", "ro", "ru", "sk",
  "sl", "sv", "th", "tr", "vi"]);

const hostedLocaleOverrides = new Map<string, Stripe.Checkout.SessionCreateParams.Locale>([
  ["en-AU", "en"], ["en-CA", "en"], ["es-ES", "es"], ["es-MX", "es-419"],
  ["or", "en"], ["pt-PT", "pt"], ["zh-Hans", "zh"], ["zh-Hant", "zh-TW"], ["zh-HK", "zh-HK"],
]);
const hostedCopyLocales = new Map([
  ["es", "es-ES"], ["es-419", "es-MX"], ["pt", "pt-PT"], ["zh", "zh-Hans"], ["zh-TW", "zh-Hant"],
]);

// Checkout's auto locale follows the browser. Select a hosted locale from the app language.
export function stripeHostedLocale(locale: string): Stripe.Checkout.SessionCreateParams.Locale {
  return hostedLocaleOverrides.get(locale) ?? (hostedLocales.has(locale) ? locale : "en");
}

export function stripeCheckoutCustomText(
  locale: Stripe.Checkout.SessionCreateParams.Locale,
): Stripe.Checkout.SessionCreateParams.CustomText {
  const copy = getStripeCopy(hostedCopyLocales.get(locale) ?? locale);
  if (copy === undefined) throw new Error("Checkout requires a server-mapped Nibomo locale.");
  return { submit: { message: [copy["offer.renewalDisclosure"], copy["offer.taxDisclosure"],
    `[${copy["legal.terms"]}](https://nibomo.com/terms/)`,
    `[${copy["legal.privacy"]}](https://nibomo.com/privacy/)`].join(" ") } };
}
