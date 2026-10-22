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

/** A Details step's own event that started being reported later than its prompt. */
export type ReviewPromptStepCoverageSubject = "notification-opened";

/** What the coverage query finds a first report of. */
export type ReviewPromptCoverageSubject = ReviewPromptId | ReviewPromptStepCoverageSubject;

/**
 * The first UTC day a platform's events of a subject arrived and the lowest app version among them,
 * `null` on web. A test build can make it a few days early.
 */
export type ReviewPromptFirstSeen = Readonly<{ date: string; version: string | null }>;

export type ReviewPromptCoverage = Readonly<{
  firstSeen: Readonly<Record<ReviewPromptCoverageSubject, Readonly<Partial<Record<ReviewPromptPlatform, ReviewPromptFirstSeen>>>>>;
  /** The highest app version recently opened on each mobile platform. */
  latestVersions: Readonly<Partial<Record<ReviewPromptPlatform, string>>>;
}>;

export type ReviewPromptActedWindow = Readonly<{ amount: number; unit: "hour" | "day" }>;

/** What counts as acting on a prompt, or why nothing can. */
export type ReviewPromptActed =
  | Readonly<{ kind: "rule"; rule: string; window: ReviewPromptActedWindow }>
  | Readonly<{ kind: "unreported"; reason: string }>;

export type ReviewPrompt = Readonly<{
  id: ReviewPromptId;
  title: string;
  /** When the prompt appears, in plain words; approximate. */
  appearsWhen: string;
  platforms: ReadonlyArray<ReviewPromptPlatform>;
  /** The platforms whose reporting of it is merged but in no released app yet; update after each release. */
  unreleasedPlatforms: ReadonlyArray<ReviewPromptPlatform>;
  acted: ReviewPromptActed;
  /** The support tables count every browser, while web product events need analytics consent. */
  source: "product-events" | "support-tables";
}>;

/** A showing is Gone when its person neither opens the app nor answers a card for this long after it. */
export const reviewPromptGoneWindowDays = 7;

/** The "Hard" reminder worked when this many answers follow it and fewer than the limit are Hard. */
export const hardReminderAnswerCount = 8;
export const hardReminderHardLimit = 5;

const allPlatforms: ReadonlyArray<ReviewPromptPlatform> = ["web", "ios", "android"];
const mobilePlatforms: ReadonlyArray<ReviewPromptPlatform> = ["ios", "android"];

const reviewPaywallActed: ReviewPromptActed = {
  kind: "rule",
  rule: "A trial or first payment credited to this paywall",
  window: { amount: paywallFirstPaymentWindowDays, unit: "day" },
};

export const reviewPrompts: ReadonlyArray<ReviewPrompt> = [
  {
    id: "paywall-initial",
    title: "Paywall: initial",
    appearsWhen: "After the 3rd review ever; free users only",
    platforms: allPlatforms,
    unreleasedPlatforms: [],
    acted: reviewPaywallActed,
    source: "product-events",
  },
  {
    id: "paywall-day3",
    title: "Paywall: day 3",
    appearsWhen: "From the 3rd day after the first paywall, once 2 reviews are done that day",
    platforms: allPlatforms,
    unreleasedPlatforms: [],
    acted: reviewPaywallActed,
    source: "product-events",
  },
  {
    id: "paywall-weekly",
    title: "Paywall: weekly",
    appearsWhen: "7+ days after the last paywall, once 2 reviews are done that day",
    platforms: allPlatforms,
    unreleasedPlatforms: [],
    acted: reviewPaywallActed,
    source: "product-events",
  },
  {
    id: "notifications-pre-prompt",
    title: "Notifications pre-prompt",
    appearsWhen: "After the 6th review ever, if notifications are off; once per install",
    platforms: mobilePlatforms,
    unreleasedPlatforms: [],
    acted: { kind: "rule", rule: "Notifications granted in the OS dialog", window: { amount: 1, unit: "day" } },
    source: "product-events",
  },
  {
    id: "hard-reminder",
    title: "“Hard” reminder",
    appearsWhen: "When 5 of the last 8 answers in a session are Hard; at most every 3 days",
    platforms: allPlatforms,
    unreleasedPlatforms: mobilePlatforms,
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
    appearsWhen: "After the 5th review today, if the person also reviewed on an earlier day; once per app version, at most every 90 days (the OS may still hide it)",
    platforms: mobilePlatforms,
    unreleasedPlatforms: mobilePlatforms,
    acted: { kind: "unreported", reason: "Apple and Google return no result" },
    source: "product-events",
  },
  {
    id: "web-mobile-app-promo",
    title: "Web mobile-app promo",
    appearsWhen: "After the 5th review today in a workspace, at most once a day, until the person reviews on mobile",
    platforms: ["web"],
    unreleasedPlatforms: [],
    acted: { kind: "rule", rule: "A store link clicked", window: { amount: 1, unit: "hour" } },
    source: "product-events",
  },
  {
    id: "automatic-feedback",
    title: "Automatic feedback",
    appearsWhen: "After the 15th review today in a workspace that also has an earlier review day; at most every 30 days",
    platforms: allPlatforms,
    unreleasedPlatforms: [],
    acted: { kind: "rule", rule: "Feedback submitted from the prompt", window: { amount: 1, unit: "hour" } },
    source: "support-tables",
  },
  {
    id: "guest-sign-in",
    title: "Guest sign-in prompt",
    appearsWhen: "Guests only, after 20 reviews in the workspace; “Later” hides it for 7 days (iOS and web also wait for 10 more reviews)",
    platforms: allPlatforms,
    unreleasedPlatforms: [],
    acted: { kind: "rule", rule: "Signed in, upgrading the guest", window: { amount: 7, unit: "day" } },
    source: "product-events",
  },
];

export function getReviewPrompt(promptId: ReviewPromptId): ReviewPrompt {
  const prompt = reviewPrompts.find((candidate) => candidate.id === promptId);
  if (prompt === undefined) {
    throw new Error(`Review prompt "${promptId}" has no definition.`);
  }

  return prompt;
}

const platformLabels: Readonly<Record<ReviewPromptPlatform, string>> = {
  web: "Web",
  ios: "iOS",
  android: "Android",
};

export function formatReviewPromptPlatforms(prompt: ReviewPrompt): string {
  return prompt.platforms.map((platform) => platformLabels[platform]).join(", ");
}

export function formatReviewPromptActedWindow(window: ReviewPromptActedWindow): string {
  return window.amount === 1 ? `1 ${window.unit}` : `${window.amount} ${window.unit}s`;
}

function joinLabels(labels: ReadonlyArray<string>): string {
  return labels.length <= 1
    ? labels.join("")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** A subject's coverage caveats on the selected ones of `platforms`, each `null` when it does not apply. */
export type ReviewPromptCoverageNotes = Readonly<{
  /** The platforms first reporting it after the selected range starts, as one phrase. */
  lateStarts: string | null;
  /** The platforms with no report of it yet, as whole sentences. */
  notReported: string | null;
}>;

/** Only `unreleasedPlatforms` without a report name a release to expect it from; the rest have it and showed none yet. */
export function buildReviewPromptCoverageNotes(
  subject: ReviewPromptCoverageSubject,
  platforms: ReadonlyArray<ReviewPromptPlatform>,
  unreleasedPlatforms: ReadonlyArray<ReviewPromptPlatform>,
  coverage: ReviewPromptCoverage,
  filters: AnalyticsFilterState,
): ReviewPromptCoverageNotes {
  const selectedPlatforms = platforms.filter((platform) => filters.eventPlatforms.includes(platform));
  const firstSeen = coverage.firstSeen[subject];
  const lateStarts = selectedPlatforms.flatMap((platform) => {
    const start = firstSeen[platform];
    return start !== undefined && filters.dateRange.from < start.date
      ? [`${platformLabels[platform]} from ${start.date}${start.version === null ? "" : ` (${start.version})`}`]
      : [];
  });
  const unreported = selectedPlatforms.filter((platform) => firstSeen[platform] === undefined);
  const notShown = unreported.filter((platform) => unreleasedPlatforms.includes(platform) === false);
  const unreleased = unreported.filter((platform) => unreleasedPlatforms.includes(platform));
  const latestVersions = unreleased.map((platform) => coverage.latestVersions[platform] ?? null);
  // Unreleased platforms sharing a latest version share one sentence.
  const notReported = [
    ...(notShown.length === 0 ? [] : [`${joinLabels(notShown.map((platform) => platformLabels[platform]))}: no showings reported yet.`]),
    ...[...new Set(latestVersions)].map((version) => {
      const labels = unreleased.filter((_platform, index) => latestVersions[index] === version).map((platform) => platformLabels[platform]);
      return `${joinLabels(labels)}: not reported yet${version === null ? "" : `; expected from the first release after ${version} (latest version in use: ${version})`}.`;
    }),
  ];

  return {
    lateStarts: lateStarts.length === 0 ? null : joinLabels(lateStarts),
    notReported: notReported.length === 0 ? null : notReported.join(" "),
  };
}

/** The counts a row's warnings depend on. */
export type ReviewPromptWarningCounts = Readonly<{
  shownCount: number;
  maturingCount: number;
  actedPendingCount: number;
}>;

/** A row's ⚠ caveats that the selected range and platforms trigger, in display order; `coverage` is `null` until it loads, which leaves out only its own notes. */
export function buildReviewPromptWarnings(
  prompt: ReviewPrompt,
  counts: ReviewPromptWarningCounts,
  coverage: ReviewPromptCoverage | null,
  filters: AnalyticsFilterState,
): ReadonlyArray<FunnelWarning> {
  const coverageNotes: ReviewPromptCoverageNotes = coverage === null
    ? { lateStarts: null, notReported: null }
    : buildReviewPromptCoverageNotes(prompt.id, prompt.platforms, prompt.unreleasedPlatforms, coverage, filters);
  const shown = counts.shownCount.toLocaleString("en-US");
  const notes: ReadonlyArray<Readonly<{ id: string; label: string; text: string | null }>> = [
    {
      id: "coverage-start",
      label: "coverage start",
      text: coverageNotes.lateStarts === null
        ? null
        : `First reported on ${coverageNotes.lateStarts}, so the selected days before that have no data for it.`,
    },
    {
      id: "not-reported",
      label: "not reported yet",
      text: coverageNotes.notReported,
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
