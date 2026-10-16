import { z } from "zod";
import type { CardMetadata, OnboardingDemoMetadata } from "./types";

type OnboardingDemoCardFields = Readonly<{
  frontText: string;
  backText: string;
  tags: ReadonlyArray<string>;
  cardType: string;
}>;

const onboardingDemoSchema = z.object({
  version: z.literal(1),
  frontText: z.string().trim().min(1),
  backText: z.string().trim(),
  tags: z.array(z.string()),
  cardType: z.string(),
  wasEdited: z.boolean().optional(),
});

// Unrecognized claims must leave cards ordinary, so they can never authorize disposal.
export function normalizeOnboardingDemo(value: unknown): OnboardingDemoMetadata | undefined {
  const parsed = onboardingDemoSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  return {
    version: 1,
    frontText: parsed.data.frontText,
    backText: parsed.data.backText,
    tags: [...new Set(parsed.data.tags)].sort(),
    cardType: parsed.data.cardType.trim() || "basic",
    wasEdited: parsed.data.wasEdited === true,
  };
}

function cardFieldsDiffer(
  baseline: OnboardingDemoCardFields,
  card: OnboardingDemoCardFields,
): boolean {
  const baselineTags = [...new Set(baseline.tags)].sort();
  const sortedTags = [...new Set(card.tags)].sort();
  return baseline.frontText !== card.frontText
    || baseline.backText !== card.backText
    || baseline.cardType !== card.cardType
    || baselineTags.length !== sortedTags.length
    || baselineTags.some((tag, index) => tag !== sortedTags[index]);
}

export function establishOnboardingDemoMetadata(
  metadata: CardMetadata,
  card: OnboardingDemoCardFields,
): CardMetadata {
  const baseline = metadata.onboardingDemo;
  if (baseline === undefined) {
    return metadata;
  }

  return {
    ...metadata,
    onboardingDemo: {
      ...baseline,
      wasEdited: baseline.wasEdited === true || cardFieldsDiffer(baseline, card),
    },
  };
}

export function mergeOnboardingDemoMetadata(
  existingCard: OnboardingDemoCardFields & Readonly<{ metadata: CardMetadata }>,
  incomingMetadata: CardMetadata,
  card: OnboardingDemoCardFields,
): CardMetadata {
  const existingMetadata = existingCard.metadata;
  const baseline = existingMetadata.onboardingDemo;
  const metadata: CardMetadata = { version: 1, source: incomingMetadata.source };
  if (baseline === undefined) {
    return metadata;
  }

  return {
    ...metadata,
    onboardingDemo: {
      ...baseline,
      wasEdited: baseline.wasEdited === true
        || incomingMetadata.onboardingDemo?.wasEdited === true
        || cardFieldsDiffer(baseline, card)
        || cardFieldsDiffer(existingCard, card)
        || JSON.stringify(existingMetadata.source) !== JSON.stringify(incomingMetadata.source),
    },
  };
}
