export type EntitlementStatus = "none" | "active" | "in_grace";

export type EntitlementSnapshot = Readonly<{
  tier: string;
  tierRank: number;
  tierDisplayName: string;
  status: EntitlementStatus;
  until: string | null;
  isTrial: boolean;
  willRenew: boolean;
  limits: Readonly<{
    aiMonthlyMessages: number | null;
    aiMonthlyWeightedTokens: number | null;
  }>;
}>;
