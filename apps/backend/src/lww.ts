export type LwwMetadata = Readonly<{
  clientUpdatedAt: string;
  lastModifiedByDeviceId: string;
  lastOperationId: string;
}>;

export function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO timestamp`);
  }

  return parsedValue.toISOString();
}

export function compareLwwMetadata(left: LwwMetadata, right: LwwMetadata): number {
  const timestampDifference =
    new Date(left.clientUpdatedAt).getTime() - new Date(right.clientUpdatedAt).getTime();

  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  const deviceComparison = left.lastModifiedByDeviceId.localeCompare(right.lastModifiedByDeviceId);
  if (deviceComparison !== 0) {
    return deviceComparison;
  }

  return left.lastOperationId.localeCompare(right.lastOperationId);
}

export function incomingLwwMetadataWins(
  incoming: LwwMetadata,
  stored: LwwMetadata,
): boolean {
  return compareLwwMetadata(incoming, stored) > 0;
}
