/** Matched by code unit, so the pattern has no `u` flag. */
const unpairedSurrogatePattern = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Postgres rejects U+0000, which binary output carries, in text and jsonb, and unpaired surrogates, which
 * model-written code can print, in jsonb. Each becomes one code unit, ␀ (U+2400) or U+FFFD, so the text
 * keeps the length its budget was measured in.
 */
export function toJsonbSafeText(text: string): string {
  return text.replaceAll("\u0000", "␀").replace(unpairedSurrogatePattern, "�");
}
