import { z } from "zod";
import { HttpError } from "../shared/errors";

export const currentAiDisclosureVersion = "2026-10-12.1";

const aiConsentInputSchema = z.object({
  eventId: z.uuid().transform((value) => value.toLowerCase()),
  installationId: z.uuid().transform((value) => value.toLowerCase()),
  action: z.enum(["grant", "withdraw"]),
  decisionSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.iso.datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)))
    .transform((value) => new Date(value).toISOString()),
  disclosureVersion: z.literal(currentAiDisclosureVersion),
  locale: z.string().min(1).max(100).regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
  disclosureText: z.string().min(1).max(20_000).refine((value) => value.trim().length > 0),
  appVersion: z.string().min(1).max(100).refine((value) => value.trim().length > 0),
  appBuild: z.string().min(1).max(100).refine((value) => value.trim().length > 0),
  platform: z.enum(["ios", "macos", "android", "web"]),
});

export type AiConsentInput = z.infer<typeof aiConsentInputSchema>;
export type AiConsentReceipt = Readonly<{
  eventId: string;
  installationId: string;
  action: "grant" | "withdraw";
  decisionSequence: number;
  disclosureVersion: string;
  occurredAt: string;
  receivedAt: string;
}>;

export function parseAiConsentInput(value: unknown): AiConsentInput {
  const parsed = aiConsentInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "Provide a complete AI consent decision with the current disclosure version.", "AI_CONSENT_INPUT_INVALID");
  }
  return parsed.data;
}

export function readAiConsentIdHeader(request: Request): string | null {
  const value = request.headers.get("X-AI-Consent-Id");
  if (value === null) return null;
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "X-AI-Consent-Id must contain a persisted grant event UUID.", "AI_CONSENT_ID_INVALID");
  }
  return parsed.data.toLowerCase();
}
