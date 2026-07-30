export const maximumGeneratedImagePromptCodePoints = 32_000;
export const maximumGeneratedImageAltTextCodePoints = 2_000;

const generatedImageAltTextControlCharacterClassSource =
  "\\u0000-\\u001f\\u007f-\\u009f";
const generatedImageAltTextControlCharacterPattern = new RegExp(
  `[${generatedImageAltTextControlCharacterClassSource}]`,
  "u",
);

export const generatedImageAltTextJsonSchemaPattern = [
  `^[^${generatedImageAltTextControlCharacterClassSource}]*`,
  `[^\\s${generatedImageAltTextControlCharacterClassSource}]`,
  `[^${generatedImageAltTextControlCharacterClassSource}]*$`,
].join("");

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function containsGeneratedImageAltTextControlCharacter(
  value: string,
): boolean {
  return generatedImageAltTextControlCharacterPattern.test(value);
}

export function hasValidGeneratedImageAltTextCharactersAndLength(
  value: string,
): boolean {
  return countUnicodeCodePoints(value) <= maximumGeneratedImageAltTextCodePoints
    && !containsGeneratedImageAltTextControlCharacter(value);
}
