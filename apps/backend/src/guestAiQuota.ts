import { query, transaction, type DatabaseExecutor } from "./db";
import { HttpError } from "./errors";

export const guestAiWeightedMonthlyTokenCap: number = 400_000;
export const guestAiWeightedOutputMultiplier: number = 6;
export const guestAiWeightedTokensPerUploadedKiB: number = 4;
export const guestAiLimitReachedCode: string = "GUEST_AI_LIMIT_REACHED";

type GuestAiMonthlyUsageRow = Readonly<{
  weighted_tokens: string | number;
}>;

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number.parseInt(value, 10);
}

function currentGuestUsageMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function calculateGuestChatWeightedTokens(
  inputTokens: number,
  outputTokens: number,
): number {
  return inputTokens + (guestAiWeightedOutputMultiplier * outputTokens);
}

export function calculateGuestDictationWeightedTokens(fileSizeBytes: number): number {
  return Math.ceil(fileSizeBytes / 1024) * guestAiWeightedTokensPerUploadedKiB;
}

export async function loadGuestAiUsageInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  usageMonth: string,
): Promise<number> {
  const result = await executor.query<GuestAiMonthlyUsageRow>(
    [
      "SELECT weighted_tokens",
      "FROM auth.guest_ai_monthly_usage",
      "WHERE user_id = $1 AND usage_month = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, usageMonth],
  );

  const row = result.rows[0];
  return row === undefined ? 0 : toNumber(row.weighted_tokens);
}

export async function appendGuestAiUsageInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  usageMonth: string,
  weightedTokens: number,
): Promise<number> {
  if (weightedTokens < 0) {
    throw new Error("weightedTokens must not be negative");
  }

  const result = await executor.query<GuestAiMonthlyUsageRow>(
    [
      "INSERT INTO auth.guest_ai_monthly_usage (user_id, usage_month, weighted_tokens, updated_at)",
      "VALUES ($1, $2, $3, now())",
      "ON CONFLICT (user_id, usage_month) DO UPDATE",
      "SET weighted_tokens = auth.guest_ai_monthly_usage.weighted_tokens + EXCLUDED.weighted_tokens,",
      "updated_at = now()",
      "RETURNING weighted_tokens",
    ].join(" "),
    [userId, usageMonth, weightedTokens],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Guest AI usage upsert did not return a row");
  }

  return toNumber(row.weighted_tokens);
}

export async function assertGuestAiLimitAvailable(
  userId: string,
  now: Date,
): Promise<void> {
  const usageMonth = currentGuestUsageMonth(now);
  const result = await query<GuestAiMonthlyUsageRow>(
    [
      "SELECT weighted_tokens",
      "FROM auth.guest_ai_monthly_usage",
      "WHERE user_id = $1 AND usage_month = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, usageMonth],
  );

  const usedWeightedTokens = result.rows[0] === undefined ? 0 : toNumber(result.rows[0].weighted_tokens);
  if (usedWeightedTokens >= guestAiWeightedMonthlyTokenCap) {
    throw new HttpError(
      429,
      "Your free monthly AI limit is used up on this device. Create an account to keep going.",
      guestAiLimitReachedCode,
    );
  }
}

export async function assertGuestAiLimitAllowsTranscription(
  userId: string,
  fileSizeBytes: number,
  now: Date,
): Promise<void> {
  const usageMonth = currentGuestUsageMonth(now);
  const nextWeightedTokens = calculateGuestDictationWeightedTokens(fileSizeBytes);

  await transaction(async (executor) => {
    const currentUsage = await loadGuestAiUsageInExecutor(executor, userId, usageMonth);
    if (currentUsage + nextWeightedTokens > guestAiWeightedMonthlyTokenCap) {
      throw new HttpError(
        429,
        "Your free monthly AI limit is used up on this device. Create an account to keep going.",
        guestAiLimitReachedCode,
      );
    }
  });
}

export async function recordGuestChatUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  now: Date,
): Promise<void> {
  const weightedTokens = calculateGuestChatWeightedTokens(inputTokens, outputTokens);
  const usageMonth = currentGuestUsageMonth(now);
  await transaction(async (executor) => {
    await appendGuestAiUsageInExecutor(executor, userId, usageMonth, weightedTokens);
  });
}

export async function recordGuestDictationUsage(
  userId: string,
  fileSizeBytes: number,
  now: Date,
): Promise<void> {
  const weightedTokens = calculateGuestDictationWeightedTokens(fileSizeBytes);
  const usageMonth = currentGuestUsageMonth(now);
  await transaction(async (executor) => {
    await appendGuestAiUsageInExecutor(executor, userId, usageMonth, weightedTokens);
  });
}
