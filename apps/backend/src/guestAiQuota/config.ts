let resolvedGuestAiWeightedMonthlyTokenCap: number | undefined;

function parseGuestAiWeightedMonthlyTokenCap(rawValue: string): number {
  const trimmedValue = rawValue.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    throw new Error(
      `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP must be a non-negative integer when set, got "${rawValue}"`,
    );
  }

  const parsedValue = Number.parseInt(trimmedValue, 10);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(
      `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP must be a safe non-negative integer, got "${rawValue}"`,
    );
  }

  return parsedValue;
}

export function getGuestAiWeightedMonthlyTokenCap(): number {
  if (resolvedGuestAiWeightedMonthlyTokenCap !== undefined) {
    return resolvedGuestAiWeightedMonthlyTokenCap;
  }

  const rawValue = process.env.GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP;
  if (rawValue === undefined || rawValue.trim() === "") {
    resolvedGuestAiWeightedMonthlyTokenCap = 0;
    return resolvedGuestAiWeightedMonthlyTokenCap;
  }

  resolvedGuestAiWeightedMonthlyTokenCap = parseGuestAiWeightedMonthlyTokenCap(rawValue);
  return resolvedGuestAiWeightedMonthlyTokenCap;
}

export function resetGuestAiQuotaConfigForTests(): void {
  resolvedGuestAiWeightedMonthlyTokenCap = undefined;
}
