import { deckVersionDiscriminatorLength } from "../../filters/analyticsFilters";
import type { CatalogDeckOption } from "../../filters/optionsQuery";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import {
  buildFunnelGroupLabel,
  foldFunnelGroupsWith,
  unresolvedFunnelGroupKey,
  type FunnelGroup,
  type FunnelGroupByField,
  type FunnelGroupCounts,
} from "../funnels/funnelGroupBy";
import type { FunnelStage } from "../funnels/FunnelStepsChart";
import {
  catalogInstallConversionWindowDays,
  type CatalogInstallFailureBucket,
  type CatalogInstallFunnelReport,
  type CatalogInstallFunnelVisit,
} from "./query";

const funnelMainStepIds = [
  "deck-page-view",
  "install-click",
  "import-screen",
  "import-confirm",
  "install-started",
  "installed",
  "one-review",
  "engaged",
  "engaged-returning",
] as const;

type FunnelMainStepId = (typeof funnelMainStepIds)[number];

export const catalogInstallFunnelAnchor: FunnelAnchor<FunnelMainStepId> = {
  funnelId: "deck",
  stepIds: funnelMainStepIds,
};

type StepCount = Readonly<{ label: string; count: number }>;
type StepDefinition = Readonly<{ label: string; isReached: (visit: CatalogInstallFunnelVisit) => boolean }>;
type FailureTotal = CatalogInstallFailureBucket & Readonly<{ count: number }>;

const engagedReviewThreshold = 20;

export type CatalogInstallFunnelGroupByDimension = FunnelGroupByField & Readonly<{
  readGroupKey: (visit: CatalogInstallFunnelVisit) => string | null;
}>;

const deckGroupByDimensionId = "deck";

export const catalogInstallFunnelGroupByDimensions: ReadonlyArray<CatalogInstallFunnelGroupByDimension> = [
  { id: deckGroupByDimensionId, label: "Deck version", readGroupKey: (visit) => visit.packageVersionId },
  { id: "country", label: "Connection country", readGroupKey: (visit) => visit.connectionCountry },
  { id: "language", label: "App interface language", readGroupKey: (visit) => visit.appUiLanguage },
  { id: "placement", label: "Catalog link placement", readGroupKey: (visit) => visit.clickPlacement },
  { id: "source", label: "Traffic source", readGroupKey: (visit) => visit.source },
  { id: "device-category", label: "Device category", readGroupKey: (visit) => visit.deviceCategory },
  {
    id: "click-language",
    label: "Browser language at click",
    readGroupKey: (visit) => visit.clickBrowserLanguage,
  },
];

export type CatalogInstallFunnelReportModel = Readonly<{
  mainStages: ReadonlyArray<FunnelStage<FunnelMainStepId>>;
  groups: ReadonlyArray<FunnelGroup<FunnelMainStepId>> | null;
  authStages: ReadonlyArray<StepCount>;
  failureTotals: ReadonlyArray<FailureTotal>;
  medianInstallSeconds: number | null;
  newIdentityInstallerCount: number;
  returningIdentityInstallerCount: number;
  directVisitorCount: number;
  maturingCount: number;
  maturityEntryCount: number;
  previewersWithoutVisitCount: number;
  installersWithoutVisitCount: number;
  hasVisits: boolean;
}>;

function getFirstInstallVisitByPerson(
  visits: ReadonlyArray<CatalogInstallFunnelVisit>,
): ReadonlyArray<CatalogInstallFunnelVisit> {
  const firstInstallByActor = new Map<string, CatalogInstallFunnelVisit>();
  for (const visit of visits) {
    if (visit.installedAt === null) {
      continue;
    }

    const current = firstInstallByActor.get(visit.actorId);
    // Compared as instants: the admin API writes whole seconds without `.000`, so the strings do not sort.
    if (
      current === undefined
      || (
        current.installedAt !== null
        && new Date(visit.installedAt).getTime() < new Date(current.installedAt).getTime()
      )
    ) {
      firstInstallByActor.set(visit.actorId, visit);
    }
  }

  return Array.from(firstInstallByActor.values());
}

function getMedianInstallSeconds(firstInstallVisits: ReadonlyArray<CatalogInstallFunnelVisit>): number | null {
  const values = firstInstallVisits
    .map((visit) => (
      (new Date(visit.installedAt ?? visit.visitedAt).getTime() - new Date(visit.visitedAt).getTime()) / 1000
    ))
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }

  const middleIndex = Math.floor(values.length / 2);
  const middle = values[middleIndex];
  if (middle === undefined) {
    return null;
  }

  if (values.length % 2 === 1) {
    return middle;
  }

  return ((values[middleIndex - 1] ?? middle) + middle) / 2;
}

function countPeopleAtEachStep<Step extends StepDefinition>(
  visits: ReadonlyArray<CatalogInstallFunnelVisit>,
  steps: ReadonlyArray<Step>,
): ReadonlyArray<Step & Readonly<{ count: number }>> {
  const reachedStepCountByActor = new Map<string, number>();
  for (const visit of visits) {
    const firstMissedIndex = steps.findIndex((step) => step.isReached(visit) === false);
    const reachedStepCount = firstMissedIndex === -1 ? steps.length : firstMissedIndex;
    reachedStepCountByActor.set(
      visit.actorId,
      Math.max(reachedStepCountByActor.get(visit.actorId) ?? 0, reachedStepCount),
    );
  }

  const reachedStepCounts = Array.from(reachedStepCountByActor.values());
  return steps.map((step, index) => ({
    ...step,
    count: reachedStepCounts.filter((reachedStepCount) => reachedStepCount > index).length,
  }));
}

function buildMainStages(
  visits: ReadonlyArray<CatalogInstallFunnelVisit>,
  hashedDeckPageViewCount: number,
  hashedInstallClickCount: number,
): ReadonlyArray<FunnelStage<FunnelMainStepId>> {
  // Keyed by id, so the compiler demands every step exactly once; the order comes from `funnelMainStepIds`,
  // which is also where the URL codec reads its default, the first step.
  const steps: Readonly<Record<FunnelMainStepId, StepDefinition>> = {
    "deck-page-view": { label: "Viewed any deck page", isReached: () => true },
    "install-click": { label: "Install clicked", isReached: (visit) => visit.installClickedAt !== null },
    "import-screen": { label: "Import screen", isReached: (visit) => visit.importScreenAt !== null },
    "import-confirm": { label: "Import confirm", isReached: (visit) => visit.importConfirmAt !== null },
    "install-started": { label: "Install started", isReached: (visit) => visit.installStartedAt !== null },
    installed: { label: "Installed (server)", isReached: (visit) => visit.installedAt !== null },
    "one-review": { label: "1+ review", isReached: (visit) => (visit.installReviewCount ?? 0) >= 1 },
    engaged: {
      label: `${engagedReviewThreshold}+ reviews`,
      isReached: (visit) => (visit.installReviewCount ?? 0) >= engagedReviewThreshold,
    },
    "engaged-returning": {
      label: `${engagedReviewThreshold}+ reviews with a return day`,
      isReached: (visit) => visit.installHasReturnDay === true,
    },
  };

  // Keyed by id so a renamed or reordered step cannot silently move the hashed people onto a step
  // they could never have reached; every other step takes the zero.
  const hashedCountByStepId: Readonly<Partial<Record<FunnelMainStepId, number>>> = {
    "deck-page-view": hashedDeckPageViewCount,
    "install-click": hashedInstallClickCount,
  };

  return countPeopleAtEachStep(visits, funnelMainStepIds.map((id) => ({ id, ...steps[id] })))
    .map((stage) => {
      const hashedCount = hashedCountByStepId[stage.id] ?? 0;
      return { id: stage.id, label: stage.label, count: stage.count + hashedCount, hashedCount };
    });
}

type CatalogInstallFunnelGroup = FunnelGroupCounts<FunnelMainStepId> & Readonly<{
  visits: ReadonlyArray<CatalogInstallFunnelVisit>;
}>;

function buildGroupLabeller(
  dimension: CatalogInstallFunnelGroupByDimension,
  groupKeys: ReadonlyArray<string>,
  catalogDeckOptions: ReadonlyArray<CatalogDeckOption>,
): (groupKey: string) => string {
  if (dimension.id !== deckGroupByDimensionId) {
    return (groupKey) => buildFunnelGroupLabel(dimension, groupKey);
  }

  const slugByPackageVersionId = new Map(
    catalogDeckOptions.map((deck) => [deck.packageVersionId, deck.packageSlug] as const),
  );
  const groupCountBySlug = new Map<string, number>();
  for (const groupKey of groupKeys) {
    const slug = slugByPackageVersionId.get(groupKey);
    if (slug !== undefined) {
      groupCountBySlug.set(slug, (groupCountBySlug.get(slug) ?? 0) + 1);
    }
  }

  return (groupKey) => {
    const slug = slugByPackageVersionId.get(groupKey);
    if (slug === undefined) {
      return buildFunnelGroupLabel(dimension, groupKey);
    }

    return (groupCountBySlug.get(slug) ?? 0) > 1
      ? `${slug} — ${groupKey.slice(0, deckVersionDiscriminatorLength)}`
      : slug;
  };
}

function buildGroups(
  visits: ReadonlyArray<CatalogInstallFunnelVisit>,
  hashedDeckPageViewCount: number,
  hashedInstallClickCount: number,
  dimension: CatalogInstallFunnelGroupByDimension,
  catalogDeckOptions: ReadonlyArray<CatalogDeckOption>,
): ReadonlyArray<CatalogInstallFunnelGroup> {
  const visitsByGroupKey = new Map<string, Array<CatalogInstallFunnelVisit>>();
  for (const visit of visits) {
    const groupKey = dimension.readGroupKey(visit) ?? unresolvedFunnelGroupKey;
    const groupVisits = visitsByGroupKey.get(groupKey) ?? [];
    groupVisits.push(visit);
    visitsByGroupKey.set(groupKey, groupVisits);
  }

  if (hashedDeckPageViewCount > 0 && visitsByGroupKey.has(unresolvedFunnelGroupKey) === false) {
    visitsByGroupKey.set(unresolvedFunnelGroupKey, []);
  }

  // Named after every key is known, because a deck slug is shortened only against the other decks
  // on this chart.
  const buildGroupLabel = buildGroupLabeller(
    dimension,
    Array.from(visitsByGroupKey.keys()),
    catalogDeckOptions,
  );

  return Array.from(visitsByGroupKey, ([groupKey, groupVisits]) => ({
    key: groupKey,
    label: buildGroupLabel(groupKey),
    visits: groupVisits,
    stages: groupKey === unresolvedFunnelGroupKey
      ? buildMainStages(groupVisits, hashedDeckPageViewCount, hashedInstallClickCount)
      : buildMainStages(groupVisits, 0, 0),
  }));
}

function buildAuthStages(visits: ReadonlyArray<CatalogInstallFunnelVisit>): ReadonlyArray<StepCount> {
  return countPeopleAtEachStep(visits, [
    { label: "Signed-out import gate", isReached: (visit) => visit.signedOutGateAt !== null },
    { label: "Signed in on this browser", isReached: (visit) => visit.signedInAt !== null },
    { label: "Import confirm after sign-in", isReached: (visit) => visit.signedOutImportConfirmAt !== null },
  ]).map(({ label, count }) => ({ label, count }));
}

function countPeopleWhere(
  visits: ReadonlyArray<CatalogInstallFunnelVisit>,
  matches: (visit: CatalogInstallFunnelVisit) => boolean,
): number {
  return new Set(visits.filter(matches).map((visit) => visit.actorId)).size;
}

function countMaturingPeople(visits: ReadonlyArray<CatalogInstallFunnelVisit>, generatedAtUtc: string): number {
  const firstVisitMsByActor = new Map<string, number>();
  for (const visit of visits) {
    const visitedMs = new Date(visit.visitedAt).getTime();
    firstVisitMsByActor.set(visit.actorId, Math.min(firstVisitMsByActor.get(visit.actorId) ?? visitedMs, visitedMs));
  }

  const nowMs = new Date(generatedAtUtc).getTime();
  return Array.from(firstVisitMsByActor.values())
    .filter((firstVisitMs) => firstVisitMs + catalogInstallConversionWindowDays * 86_400_000 > nowMs)
    .length;
}

function buildFailureTotals(visits: ReadonlyArray<CatalogInstallFunnelVisit>): ReadonlyArray<FailureTotal> {
  const actorsByKey = new Map<string, Readonly<{ bucket: CatalogInstallFailureBucket; actorIds: Set<string> }>>();
  for (const visit of visits) {
    for (const bucket of visit.failureBuckets) {
      const key = `${bucket.stage}:${bucket.reason}`;
      const entry = actorsByKey.get(key) ?? { bucket, actorIds: new Set<string>() };
      entry.actorIds.add(visit.actorId);
      actorsByKey.set(key, entry);
    }
  }

  return Array.from(actorsByKey.values(), (entry): FailureTotal => ({ ...entry.bucket, count: entry.actorIds.size })).sort((left, right) => (
    right.count - left.count
    || left.stage.localeCompare(right.stage)
    || left.reason.localeCompare(right.reason)
  ));
}

function buildFoldedGroups(
  report: CatalogInstallFunnelReport | null,
  groupByDimensionId: string | null,
  catalogDeckOptions: ReadonlyArray<CatalogDeckOption>,
): ReadonlyArray<FunnelGroup<FunnelMainStepId>> | null {
  if (report === null || groupByDimensionId === null) {
    return null;
  }

  const dimension = catalogInstallFunnelGroupByDimensions.find((candidate) => candidate.id === groupByDimensionId);
  if (dimension === undefined) {
    throw new Error(`Unknown deck page to install funnel grouping: ${groupByDimensionId}`);
  }

  return foldFunnelGroupsWith<FunnelMainStepId, CatalogInstallFunnelGroup>(
    dimension,
    buildGroups(
      report.visits,
      report.hashedDeckPageViewCount,
      report.hashedInstallClickCount,
      dimension,
      catalogDeckOptions,
    ),
    // One actor can occur in several folded groups. Recount their visits instead of summing groups;
    // cookieless counts stay in Unresolved, which is never folded.
    (foldedGroups) => buildMainStages(foldedGroups.flatMap((group) => group.visits), 0, 0),
  );
}

export function buildCatalogInstallFunnelReportModel(
  report: CatalogInstallFunnelReport | null,
  groupByDimensionId: string | null,
  catalogDeckOptions: ReadonlyArray<CatalogDeckOption>,
): CatalogInstallFunnelReportModel {
  const visits = report === null ? [] : report.visits;
  const hashedDeckPageViewCount = report === null ? 0 : report.hashedDeckPageViewCount;
  const hashedInstallClickCount = report === null ? 0 : report.hashedInstallClickCount;
  const mainStages = buildMainStages(visits, hashedDeckPageViewCount, hashedInstallClickCount);
  const firstInstallVisits = getFirstInstallVisitByPerson(visits);

  // Grouping changes only the chart; summaries always use the complete report.
  return {
    mainStages,
    groups: buildFoldedGroups(report, groupByDimensionId, catalogDeckOptions),
    authStages: buildAuthStages(visits),
    failureTotals: buildFailureTotals(visits),
    medianInstallSeconds: getMedianInstallSeconds(firstInstallVisits),
    newIdentityInstallerCount: firstInstallVisits.filter((visit) => visit.installActorIsNew === true).length,
    returningIdentityInstallerCount: firstInstallVisits.filter((visit) => visit.installActorIsNew === false).length,
    directVisitorCount: countPeopleWhere(visits, (visit) => visit.source === "direct"),
    maturingCount: report === null ? 0 : countMaturingPeople(visits, report.generatedAtUtc),
    // Only identified people have a seven-day window.
    maturityEntryCount: (mainStages[0]?.count ?? 0) - (mainStages[0]?.hashedCount ?? 0),
    previewersWithoutVisitCount: report === null ? 0 : report.previewersWithoutVisitCount,
    installersWithoutVisitCount: report === null ? 0 : report.installersWithoutVisitCount,
    // A cookieless-only report has a funnel even though it contains no visit rows.
    hasVisits: visits.length > 0 || hashedDeckPageViewCount > 0,
  };
}
