const generatedImageOperationKeyPrefix = "generated-image:";

export function createGeneratedImageOperationKey(
  generatedImageOrdinal: number,
): string {
  if (
    !Number.isSafeInteger(generatedImageOrdinal)
    || generatedImageOrdinal < 1
  ) {
    throw new RangeError(
      "Generated image operation ordinal must be a positive safe integer.",
    );
  }
  return `${generatedImageOperationKeyPrefix}${String(generatedImageOrdinal)}`;
}

export function isGeneratedImageOperationKey(value: string): boolean {
  if (!value.startsWith(generatedImageOperationKeyPrefix)) {
    return false;
  }
  const ordinalText = value.slice(generatedImageOperationKeyPrefix.length);
  if (!/^[1-9][0-9]*$/u.test(ordinalText)) {
    return false;
  }
  const ordinal = Number(ordinalText);
  return Number.isSafeInteger(ordinal)
    && createGeneratedImageOperationKey(ordinal) === value;
}
