const mediaAssetLastOperationIdPattern =
  /^([!-~]|[!-~][ -~]*[!-~])$/u;
export const maximumMediaAssetLastOperationIdLength = 1_024;

export function isValidMediaAssetLastOperationId(value: string): boolean {
  return (
    value.length <= maximumMediaAssetLastOperationIdLength
    && mediaAssetLastOperationIdPattern.test(value)
  );
}

export function isValidMediaAssetLastOperationIdPrefix(
  value: string,
  maximumLength: number,
): boolean {
  return (
    value.length <= maximumLength
    && mediaAssetLastOperationIdPattern.test(value)
  );
}
