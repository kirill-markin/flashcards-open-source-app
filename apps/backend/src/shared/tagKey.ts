/** The code points JS String.prototype.trim strips: ECMA-262 WhiteSpace, which is tab, line
 * tabulation, form feed, U+FEFF and every Space_Separator, plus the line terminators. Postgres
 * has no class that matches it: [[:space:]] under the RDS en_US.UTF-8 ctype covers most Unicode
 * spaces but not U+00A0, U+2007, U+202F or U+FEFF, and it matches U+0085 and U+001C-U+001F, which
 * JS trim keeps. Spelling the set out is what keeps the two trims identical. */
const jsTrimCodePoints = String.raw`\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF`;

/** Keys a tag name in the order the web's normalizeTagKey (apps/web/src/appData/domain/index.ts)
 * does; iOS omits the NFC step, and Android's trim-last order is equivalent because case mapping
 * neither creates nor removes whitespace. */
export function normalizeTagKey(tag: string): string {
  return tag.normalize("NFC").trim().toLowerCase();
}

/** normalizeTagKey over the unnested `tag` column. Stored tags are trimmed here because no write
 * path trims them, on exactly the code points above, so a spelling edged with one of them keys
 * the same as the JS-trimmed name a caller sends. normalize() and Unicode escapes both require a
 * UTF8 database and raise otherwise. Case folding is the one axis left diverging: Postgres
 * lower() under the RDS en_US.UTF-8 ctype collapses more than V8 does, mapping U+0130 to "i" and
 * every sigma to the medial one, so a stored "İstanbul" or "ΟΔΟΣ" matches a requested "istanbul"
 * or "οδοσ" but not its own spelling. Accepted because both directions stay case-only. */
export const storedTagKeyExpression = `lower(btrim(normalize(tag, NFC), E'${jsTrimCodePoints}'))`;
