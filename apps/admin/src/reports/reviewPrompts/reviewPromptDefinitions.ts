import type { ReviewEventPlatform } from "../../adminApi";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelWarning } from "../funnels/funnelWarnings";
import { paywallFirstPaymentWindowDays } from "../paywallFunnel/attributionQuery";

/** Every prompt that can appear after a review, in table order; each id is also its Details path slug. */
export const reviewPromptIds = [
  "paywall-initial",
  "paywall-day3",
  "paywall-weekly",
  "notifications-pre-prompt",
  "hard-reminder",
  "rating-request",
  "web-mobile-app-promo",
  "automatic-feedback",
  "guest-sign-in",
] as const;

export type ReviewPromptId = (typeof reviewPromptIds)[number];

export type ReviewPromptPlatform = Extract<ReviewEventPlatform, "web" | "ios" | "android">;

/**
 * The first whole UTC day a platform reports a prompt, with the app version that brought it, or
 * `null` while no released app on that platform reports it yet. Showings before it are not counted.
 */
export type ReviewPromptCoverage = Readonly<{
  platform: ReviewPromptPlatform;
  start: Readonly<{ date: string; version: string | null }> | null;
}>;

export type ReviewPromptActedWindow = Readonly<{ amount: number; unit: "hour" | "day" }>;

/** What counts as acting on a prompt, or why nothing can. */
export type ReviewPromptActed =
  | Readonly<{ kind: "rule"; rule: string; window: ReviewPromptActedWindow }>
  | Readonly<{ kind: "unreported"; reason: string }>;

export type ReviewPrompt = Readonly<{
  id: ReviewPromptId;
  title: string;
  coverage: ReadonlyArray<ReviewPromptCoverage>;
  acted: ReviewPromptActed;
  /** The support tables count every browser, while web product events need analytics consent. */
  source: "product-events" | "support-tables";
}>;

/** A showing is Gone when its person neither opens the app nor answers a card for this long after it. */
export const reviewPromptGoneWindowDays = 7;

/** The "Hard" reminder worked when this many answers follow it and fewer than the limit are Hard. */
export const hardReminderAnswerCount = 8;
export const hardReminderHardLimit = 5;

const reviewPaywallCoverage: ReadonlyArray<ReviewPromptCoverage> = [
  { platform: "web", start: { date: "2026-10-19", version: "1.35.0" } },
  { platform: "ios", start: { date: "2026-10-20", version: "1.36.0" } },
  { platform: "android", start: { date: "2026-10-22", version: "1.37.0" } },
];

const mobilePromptCoverageStart = { date: "2026-09-02", version: "1.23.0" } as const;

// The first full UTC day after the web deploy that began reporting these prompts.
const webPromptCoverageStart = { date: "2026-10-23", version: null } as const;

const reviewPaywallActed: ReviewPromptActed = {
  kind: "rule",
  rule: "A trial or first payment credited to this paywall",
  window: { amount: paywallFirstPaymentWindowDays, unit: "day" },
};

export const reviewPrompts: ReadonlyArray<ReviewPrompt> = [
  { id: "paywall-initial", title: "Paywall: initial", coverage: reviewPaywallCoverage, acted: reviewPaywallActed, source: "product-events" },
  { id: "paywall-day3", title: "Paywall: day 3", coverage: reviewPaywallCoverage, acted: reviewPaywallActed, source: "product-events" },
  { id: "paywall-weekly", title: "Paywall: weekly", coverage: reviewPaywallCoverage, acted: reviewPaywallActed, source: "product-events" },
  {
    id: "notifications-pre-prompt",
    title: "Notifications pre-prompt",
    coverage: [
      { platform: "ios", start: mobilePromptCoverageStart },
      { platform: "android", start: mobilePromptCoverageStart },
    ],
    acted: { kind: "rule", rule: "Notifications granted in the OS dialog", window: { amount: 1, unit: "day" } },
    source: "product-events",
  },
  {
    id: "hard-reminder",
    title: "“Hard” reminder",
    coverage: [
      { platform: "web", start: webPromptCoverageStart },
      { platform: "ios", start: null },
      { platform: "android", start: null },
    ],
    acted: {
      kind: "rule",
      rule: `${hardReminderAnswerCount} more answers, fewer than ${hardReminderHardLimit} of them Hard,`,
      window: { amount: reviewPromptGoneWindowDays, unit: "day" },
    },
    source: "product-events",
  },
  {
    id: "rating-request",
    title: "Store rating requested",
    coverage: [
      { platform: "ios", start: null },
      { platform: "android", start: null },
    ],
    acted: { kind: "unreported", reason: "Apple and Google return no result" },
    source: "product-events",
  },
  {
    id: "web-mobile-app-promo",
    title: "Web mobile-app promo",
    coverage: [{ platform: "web", start: webPromptCoverageStart }],
    acted: { kind: "rule", rule: "A store link clicked", window: { amount: 1, unit: "hour" } },
    source: "product-events",
  },
  {
    id: "automatic-feedback",
    title: "Automatic feedback",
    coverage: (["web", "ios", "android"] as const).map((platform) => ({
      platform,
      start: { date: "2026-06-05", version: null },
    })),
    acted: { kind: "rule", rule: "Feedback submitted from the prompt", window: { amount: 1, unit: "hour" } },
    source: "support-tables",
  },
  {
    id: "guest-sign-in",
    title: "Guest sign-in prompt",
    coverage: [
      { platform: "web", start: webPromptCoverageStart },
      { platform: "ios", start: mobilePromptCoverageStart },
      { platform: "android", start: mobilePromptCoverageStart },
    ],
    acted: { kind: "rule", rule: "Signed in, upgrading the guest", window: { amount: 7, unit: "day" } },
    source: "product-events",
  },
];

const platformLabels: Readonly<Record<ReviewPromptPlatform, string>> = {
  web: "Web",
  ios: "iOS",
  android: "Android",
};

export function formatReviewPromptPlatforms(prompt: ReviewPrompt): string {
  return prompt.coverage.map((coverage) => platformLabels[coverage.platform]).join(", ");
}

export function formatReviewPromptActedWindow(window: ReviewPromptActedWindow): string {
  return window.amount === 1 ? `1 ${window.unit}` : `${window.amount} ${window.unit}s`;
}

function joinLabels(labels: ReadonlyArray<string>): string {
  return labels.length <= 1
    ? labels.join("")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The counts a row's warnings depend on. */
export type ReviewPromptWarningCounts = Readonly<{
  shownCount: number;
  maturingCount: number;
  actedPendingCount: number;
}>;

/** A row's ⚠ caveats that the selected range and platforms trigger, in display order. */
export function buildReviewPromptWarnings(
  prompt: ReviewPrompt,
  counts: ReviewPromptWarningCounts,
  filters: AnalyticsFilterState,
): ReadonlyArray<FunnelWarning> {
  const selectedCoverage = prompt.coverage.filter((coverage) => filters.eventPlatforms.includes(coverage.platform));
  const lateStarts = selectedCoverage.flatMap((coverage) => (
    coverage.start !== null && filters.dateRange.from < coverage.start.date
      ? [`${platformLabels[coverage.platform]} from ${coverage.start.date}${coverage.start.version === null ? "" : ` (${coverage.start.version})`}`]
      : []
  ));
  const unreleased = selectedCoverage.flatMap((coverage) => (coverage.start === null ? [platformLabels[coverage.platform]] : []));
  const shown = counts.shownCount.toLocaleString("en-US");
  const notes: ReadonlyArray<Readonly<{ id: string; label: string; text: string | null }>> = [
    {
      id: "coverage-start",
      label: "coverage start",
      text: lateStarts.length === 0
        ? null
        : `Counted on ${joinLabels(lateStarts)}, so the selected days before that have no data for it.`,
    },
    {
      id: "next-release",
      label: "next release",
      text: unreleased.length === 0
        ? null
        : `${joinLabels(unreleased)} ${unreleased.length === 1 ? "reports this only from its" : "report this only from their"} next app release.`,
    },
    {
      id: "consent",
      label: "consent",
      text: prompt.source === "support-tables" && filters.eventPlatforms.includes("web")
        ? "These showings come from the feedback tables and count every browser, while web product events count only browsers that accepted analytics consent."
        : null,
    },
    {
      id: "maturing",
      label: "gone maturing",
      text: counts.maturingCount === 0
        ? null
        : `${counts.maturingCount.toLocaleString("en-US")} of ${shown} showings are less than ${reviewPromptGoneWindowDays} days old with no app open or answered card yet, so Gone leaves them out until their ${reviewPromptGoneWindowDays} days pass.`,
    },
    {
      id: "acted-pending",
      label: "acted pending",
      text: prompt.acted.kind === "rule" && counts.actedPendingCount > 0
        ? `Acted can still grow for ${counts.actedPendingCount.toLocaleString("en-US")} of ${shown} showings less than ${formatReviewPromptActedWindow(prompt.acted.window)} old.`
        : null,
    },
  ];

  return notes.flatMap((note) => (note.text === null ? [] : [{ id: note.id, label: note.label, text: note.text }]));
}
