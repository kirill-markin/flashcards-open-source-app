/**
 * Cuts measured in UTF-16 code units, like `String.length`, that never split a surrogate pair: half a
 * pair is an unpaired surrogate, which Postgres rejects in jsonb.
 */

function splitsSurrogatePair(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** The longest prefix of at most `maximumChars` code units. */
export function cutHeadAtCodePoint(text: string, maximumChars: number): string {
  if (text.length <= maximumChars) {
    return text;
  }

  return text.slice(0, splitsSurrogatePair(text, maximumChars) ? maximumChars - 1 : maximumChars);
}

/** The longest suffix of at most `maximumChars` code units. */
export function cutTailAtCodePoint(text: string, maximumChars: number): string {
  if (text.length <= maximumChars) {
    return text;
  }

  const start = text.length - maximumChars;
  return text.slice(splitsSurrogatePair(text, start) ? start + 1 : start);
}
