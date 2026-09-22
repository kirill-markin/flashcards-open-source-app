import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { deckVersionDiscriminatorLength } from "../../filters/AnalyticsFilterBar";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { CatalogDeckOption } from "../../filters/optionsQuery";
import { isFunnelAllAudienceSelected, isFunnelHashedCohortRead } from "../funnels/funnelAudienceSql";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
import { FunnelGroupByPicker } from "../funnels/FunnelGroupByPicker";
import {
  buildFunnelGroupLabel,
  foldFunnelGroupsWith,
  parseFunnelGroupByDimension,
  unresolvedFunnelGroupKey,
  writeFunnelGroupByToUrl,
  type FunnelGroup,
  type FunnelGroupByField,
  type FunnelGroupCounts,
} from "../funnels/funnelGroupBy";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { formatPercentage, FunnelStepsChart, type FunnelStage } from "../funnels/FunnelStepsChart";
import {
  catalogInstallConversionWindowDays,
  catalogInstallFunnelStartDate,
  loadCatalogInstallFunnelReport,
  type CatalogInstallFailureBucket,
  type CatalogInstallFunnelReport,
  type CatalogInstallFunnelVisit,
} from "./query";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: CatalogInstallFunnelReport }>;

/** The nine main funnel steps in chart order; `buildMainStages` takes its order from this list. */
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

export const catalogInstallFunnelTitle = "Deck page to install";

type StepCount = Readonly<{ label: string; count: number }>;
type StepDefinition = Readonly<{ label: string; isReached: (visit: CatalogInstallFunnelVisit) => boolean }>;
type FailureTotal = CatalogInstallFailureBucket & Readonly<{ count: number }>;

/** Where "studied it properly" is drawn, rather than merely opened the deck once. */
const engagedReviewThreshold = 20;

/** One identity for every render without a report, so the derived counts below are memoized once. */
const noVisits: ReadonlyArray<CatalogInstallFunnelVisit> = [];

/**
 * One thing this funnel can be grouped by: a reader over a loaded row rather than a SQL expression.
 *
 * THAT IS WHERE THIS FUNNEL DEPARTS FROM `FunnelGroupByDimension` in `../funnels/funnelGroupBy.ts`,
 * and it is a difference in the query rather than in the field. A funnel reduced in SQL has to name
 * its key inside the statement, so its dimension carries one; this query already returns one row per
 * visit and `countPeopleAtEachStep` below reduces them in the browser, so a dimension here only has
 * to say which value of a row it reads. Picking one therefore regroups the rows already in hand and
 * never reloads the report, which is also why the loaded report and the selected dimension can never
 * disagree the way they can on a funnel that regroups in SQL. `null` is the dimension saying it
 * cannot place that row.
 */
type CatalogInstallFunnelGroupByDimension = FunnelGroupByField & Readonly<{
  readGroupKey: (visit: CatalogInstallFunnelVisit) => string | null;
}>;

/** The dimension whose keys are `package_version_id`, which is the one dimension that has to be named. */
const deckGroupByDimensionId = "deck";

/**
 * What the `Group by` field offers, in picker order.
 *
 * Every one of them is a value the row already carries, and the four the query projects only for
 * this field are documented on `CatalogInstallFunnelVisit`.
 *
 * ONLY `country` AND `language` PARTITION THE PEOPLE, and the reason is the row unit rather than any
 * one dimension: a row is one identity and one deck version, so a key read off a row is a property
 * of that pair, and a person whose deck rows disagree on it enters two groups. `deck` splits by
 * definition; `source` and `device-category` are each row's own anchoring page view's, so the
 * ordinary catalog browse - found by search, then on to the next deck from inside the site - is one
 * person under two; `placement` and `click-language` are each row's own install click's, so a person
 * who clicked on one deck and not on another is in a value group and in `Unresolved` at once. Only
 * the country and the language are reduced per actor, by `buildActorConnectionCountrySql` and
 * `buildActorAppUiLanguageSql`, which group by `actor_id` and give a person one value whatever their
 * rows say. `buildGroups`, the chart's footnote and `docs/admin-app.md` all state that split, and
 * the folded `Other` is re-reduced from visits because of it.
 *
 * NO DIMENSION HERE IS NARROWED BY THE FILTER FIELD OF ITS OWN NAME. The country and the language
 * are the identity's over the range, exactly as on the mobile funnel. The other five are the row's
 * own values while all four click filter fields read the install click, and the row's anchor is the
 * person's first page view of that deck in range while their click may be up to seven days later, so
 * a `source = search` selection keeps a person for their click and can still draw them under the
 * `direct` that page view carried - a different session, and on a shared identity not necessarily
 * even the same device. The placement and the browser language exist only on the install click, so
 * every row that never clicked is `Unresolved` under them and their value groups start at a first
 * step that is already the click; the source and the device category are on every row, clicked or
 * not.
 */
const catalogInstallFunnelGroupByDimensions: ReadonlyArray<CatalogInstallFunnelGroupByDimension> = [
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected deck page to install funnel error.";
}

/** The short note shown when the selected range starts before `catalogInstallFunnelStartDate`, or `null`. */
function buildStartDateNote(dateRange: AnalyticsFilterState["dateRange"]): string | null {
  if (dateRange.to < catalogInstallFunnelStartDate) {
    return `People count from ${catalogInstallFunnelStartDate}, the site's first full day of identified deck page views, so the selected range has no data.`;
  }

  return dateRange.from < catalogInstallFunnelStartDate
    ? `People count from ${catalogInstallFunnelStartDate}, the site's first full day of identified deck page views, so there is no data before that day.`
    : null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }

  if (seconds < 60) {
    return `${Math.round(seconds)} sec`;
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }

  return `${(seconds / 3600).toFixed(1)} hr`;
}

/** Each installing person's row with their earliest server install, so a person is one install here. */
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

/** Per person, from their earliest server install back to that row's own deck page view. */
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

/**
 * People per step, by the funnel rule in `../funnels/funnelSections.ts`.
 *
 * A person's rows are one per deck version they viewed, so the person's last step is the furthest any
 * one of those rows got through every step in order: the click, and all below it, must be on a deck
 * whose page that person viewed.
 */
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

/**
 * The nine steps of one funnel, from the first deck page view to a person who kept studying, counted
 * as people by `countPeopleAtEachStep`, then widened by the cookieless people of the `all` mode.
 *
 * The three engagement steps are measurable only on a row that reached a server install, so a
 * row with no install carries null review facts and is absent from all three. That keeps them
 * subsets of the install step above them rather than an independent test.
 *
 * The cookieless people arrive as two counts rather than as visit rows, because they have no actor,
 * no deck they can be followed to and no step below the click; the query explains why. They are added
 * onto the only two steps they can reach, so each step's `count` is the whole audience on screen and
 * `hashedCount` is the part of it that no identifier is behind.
 */
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
      return { ...stage, count: stage.count + hashedCount, hashedCount };
    });
}

/** One loaded group, plus the visits it was reduced from, which the folded `Other` re-reduces. */
type CatalogInstallFunnelGroup = FunnelGroupCounts<FunnelMainStepId> & Readonly<{
  visits: ReadonlyArray<CatalogInstallFunnelVisit>;
}>;

/**
 * How one group of the selected dimension is named on screen.
 *
 * Six of the seven name themselves: their keys are countries, locales, placements, sources and
 * device categories, which `buildFunnelGroupLabel` prints as they come. A deck version's key is a
 * 36-character UUID that no legend and no table column can be read at, so it is named the way the
 * `Catalog deck version` filter field names the very same value on this page: its slug, carrying the
 * leading `deckVersionDiscriminatorLength` characters of the id wherever two groups share that slug,
 * drawn or folded. Every key is counted rather than the five that end up drawn, because a label has
 * to exist before `foldFunnelGroupsWith` ranks the groups by size and breaks its ties on the label,
 * so a drawn version can carry the fragment while its same-slug sibling sits inside `Other`.
 *
 * The slugs come from the deck option list that field is already given, which offers only versions
 * somebody completed an install of, so a version nobody has installed keeps its raw key rather than
 * inventing a name for it - the same fallback `buildFunnelGroupLabel` makes for an unknown platform.
 * At this product stage that is not a rare bar: the groups are ranked by deck page views, and a much
 * viewed deck version nobody finished installing is an ordinary outcome, so the explainer and
 * `docs/admin-app.md` both state the limit rather than promising a slug.
 */
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

/**
 * One group per distinct value of the selected dimension, each reduced by `buildMainStages` so that
 * the funnel rule stays owned by one function and a group is measured exactly as the funnel is.
 *
 * A VISIT IS GROUPED, A PERSON IS COUNTED, and under five of the seven dimensions those are not the
 * same thing: a row is one identity and one deck version, so a person whose deck rows disagree on
 * the key enters two groups and the groups then add up to more people than the funnel holds. Only
 * `country` and `language` are per-actor values and genuinely partition it; the dimension list above
 * names the other five and what splits each of them. The folded `Other` group is built from visits
 * for the same reason, in the caller below.
 *
 * THE COOKIELESS PEOPLE OF THE `all` MODE GO TO `Unresolved` AND NOWHERE ELSE. They arrive as two
 * counts rather than as rows because they have no actor and no attributed click, which is exactly
 * what makes them unplaceable by every one of these dimensions. The group is created for them even
 * when every visit row resolved, or a grouping would drop people the ungrouped chart counts.
 */
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

/** The sign-in branch, counted as people by the same rule as the main steps. */
function buildAuthStages(visits: ReadonlyArray<CatalogInstallFunnelVisit>): ReadonlyArray<StepCount> {
  return countPeopleAtEachStep(visits, [
    { label: "Signed-out import gate", isReached: (visit) => visit.signedOutGateAt !== null },
    { label: "Signed in on this browser", isReached: (visit) => visit.signedInAt !== null },
    { label: "Import confirm after sign-in", isReached: (visit) => visit.signedOutImportConfirmAt !== null },
  ]);
}

/** Distinct people with at least one row matching `matches`. */
function countPeopleWhere(
  visits: ReadonlyArray<CatalogInstallFunnelVisit>,
  matches: (visit: CatalogInstallFunnelVisit) => boolean,
): number {
  return new Set(visits.filter(matches).map((visit) => visit.actorId)).size;
}

/** People whose first deck page view in range is still inside its seven-day window at `generatedAtUtc`. */
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

/** Distinct people per stage/reason: a person with the same failure on several rows counts once. */
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

export function CatalogInstallFunnelSection(props: FunnelSectionProps): JSX.Element {
  const [loadRevision, setLoadRevision] = useState<number>(0);
  const [loadState, setLoadState] = useState<FunnelLoadState>({ status: "loading" });
  // The field is this funnel's own, seeded from the URL on mount and written back on every pick, so
  // a reload or a shared link reopens the same grouping; `null` is the ungrouped default.
  const [groupByDimension, setGroupByDimension] = useState<CatalogInstallFunnelGroupByDimension | null>(
    () => parseFunnelGroupByDimension(
      new URLSearchParams(window.location.search),
      catalogInstallFunnelAnchor.funnelId,
      catalogInstallFunnelGroupByDimensions,
    ),
  );

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    if (props.isRangeLoading) {
      return () => { cancelled = true; };
    }

    void loadCatalogInstallFunnelReport(props.config, props.filters)
      .then((report) => {
        if (cancelled === false) {
          setLoadState({ status: "ready", report });
        }
      })
      .catch((error: unknown) => {
        if (cancelled || props.onTerminalAdminError(error, props.config)) {
          return;
        }

        setLoadState({ status: "error", message: getErrorMessage(error) });
      });

    return () => { cancelled = true; };
  }, [loadRevision, props.config, props.filters, props.isRangeLoading, props.onTerminalAdminError]);

  const report = loadState.status === "ready" ? loadState.report : null;
  const visits = report === null ? noVisits : report.visits;
  const hashedDeckPageViewCount = report === null ? 0 : report.hashedDeckPageViewCount;
  const hashedInstallClickCount = report === null ? 0 : report.hashedInstallClickCount;
  const mainStages = useMemo(
    () => buildMainStages(visits, hashedDeckPageViewCount, hashedInstallClickCount),
    [visits, hashedDeckPageViewCount, hashedInstallClickCount],
  );
  // The grouped chart, and only the chart: the stages above and every figure below - the sign-in
  // branch, the failures, the median, the two no-visit lines, the maturing warning and the empty
  // state - go on reading the whole visit set, because grouping splits these people rather than
  // narrowing them. `null` is the ungrouped chart, which is also every render before the report.
  const groups = useMemo<ReadonlyArray<FunnelGroup<FunnelMainStepId>> | null>(() => {
    if (report === null || groupByDimension === null) {
      return null;
    }

    // The type arguments are explicit because `Group` alone cannot pin the step id for the compiler.
    return foldFunnelGroupsWith<FunnelMainStepId, CatalogInstallFunnelGroup>(
      groupByDimension,
      buildGroups(
        visits,
        hashedDeckPageViewCount,
        hashedInstallClickCount,
        groupByDimension,
        props.catalogDeckOptions,
      ),
      // From the folded groups' visits rather than by summing their counts: on the deck dimension
      // one person can sit in two of them, and adding the counts would make `Other` hold more
      // people than it has. Those groups never carry the cookieless counts, which stay pinned to
      // `Unresolved`, and `Unresolved` is never folded.
      (foldedGroups) => buildMainStages(foldedGroups.flatMap((group) => group.visits), 0, 0),
    );
  }, [
    groupByDimension,
    hashedDeckPageViewCount,
    hashedInstallClickCount,
    props.catalogDeckOptions,
    report,
    visits,
  ]);
  const authStages = useMemo(() => buildAuthStages(visits), [visits]);
  const failureTotals = useMemo(() => buildFailureTotals(visits), [visits]);

  const firstInstallVisits = useMemo(() => getFirstInstallVisitByPerson(visits), [visits]);
  // A pick regroups rows the browser already holds, so nothing reloads and the URL is all that is
  // written back beside the state.
  const selectGroupByDimension = useCallback(
    (dimension: CatalogInstallFunnelGroupByDimension | null): void => {
      setGroupByDimension(dimension);
      writeFunnelGroupByToUrl(catalogInstallFunnelAnchor.funnelId, dimension?.id ?? null);
    },
    [],
  );

  const newIdentityInstallerCount = firstInstallVisits.filter((visit) => visit.installActorIsNew === true).length;
  const returningIdentityInstallerCount = firstInstallVisits.filter((visit) => visit.installActorIsNew === false).length;
  const directVisitorCount = countPeopleWhere(visits, (visit) => visit.source === "direct");
  const maturingCount = report === null ? 0 : countMaturingPeople(visits, report.generatedAtUtc);
  const previewersWithoutVisitCount = report === null ? 0 : report.previewersWithoutVisitCount;
  const installersWithoutVisitCount = report === null ? 0 : report.installersWithoutVisitCount;
  const isReady = props.isRangeLoading === false && loadState.status === "ready";
  // A range in which only cookieless visitors reached a deck page still has a funnel to draw, even
  // though not one of them produced a visit row.
  const hasVisits = isReady && (visits.length > 0 || hashedDeckPageViewCount > 0);
  const startDateNote = isReady ? buildStartDateNote(props.filters.dateRange) : null;
  // The mode alone, never the chart's `showsHashedSplit` prop: that one is the read gate below,
  // and the two differ exactly in the `all`-with-a-country case this note exists to explain.
  const wantsHashedCohort = isFunnelAllAudienceSelected(props.filters);
  // What the query actually read, which is what every sentence and column about the cookieless
  // segment is chosen on: with a country selected the mode is still `all` and the cohort is not read.
  const readsHashedCohort = isFunnelHashedCohortRead(props.filters);
  const audienceEmptyStateNote = buildFunnelAudienceEmptyStateNote(props.filters.funnelAudienceMode);
  const hashedCountryNote = isReady
    && wantsHashedCohort
    && props.filters.connectionCountries.length > 0
    ? "A connection country is selected, so the cookieless visitors are left out of these bars entirely: their rows carry no country, and keeping them would answer a country question with people whose country is unknown."
    : null;

  return (
    <section className="dashboard-section funnel-report">
      <header className="dashboard-section-header">
        <p className="eyebrow">Funnel report</p>
        <h2>{catalogInstallFunnelTitle}</h2>
      </header>

      {props.filterRow}

      {/* OUTSIDE EVERY STATE GATE BELOW, because the chart is not mounted while the report loads and
          not mounted at all while the funnel is empty. A field that unmounts on its own use drops
          keyboard focus on every pick, and once a narrowed range leaves no deck page views a
          grouping already in the URL could only be cleared by editing the URL by hand. */}
      <div className="funnel-group-by-row">
        <FunnelGroupByPicker
          funnelId={catalogInstallFunnelAnchor.funnelId}
          dimensions={catalogInstallFunnelGroupByDimensions}
          selectedDimensionId={groupByDimension === null ? null : groupByDimension.id}
          isReportLoading={props.isRangeLoading || loadState.status === "loading"}
          onSelect={selectGroupByDimension}
        />
      </div>

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading deck page to install funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}
      {/* Chosen on the read gate, not the mode: with a country selected the cookieless rows were not read, and the note above already says so. The audience mode is named as well, because it is not one of the filters the heading blames and `Reset all` does not clear it. */}
      {isReady && hasVisits === false ? <div className="report-state"><strong>No deck page views match these filters.</strong><span>{readsHashedCohort ? "Cookieless visitors are counted here through their daily hash, so this is every deck page view in range, and no earlier traffic history is inferred from Vercel aggregates." : "A page view from a browser that refused consent carries no identity and is not counted, and no earlier traffic history is inferred from Vercel aggregates."}</span>{audienceEmptyStateNote === null ? null : <span>{audienceEmptyStateNote}</span>}</div> : null}

      {/* The window belongs to the people who have one, so the denominator is the identified part of the first step. */}
      {isReady ? <FunnelMaturingWarning maturingCount={maturingCount} entryCount={(mainStages[0]?.count ?? 0) - (mainStages[0]?.hashedCount ?? 0)} /> : null}

      {hasVisits ? (
        <FunnelStepsChart
          anchor={catalogInstallFunnelAnchor}
          stages={mainStages}
          groups={groups ?? undefined}
          countLabel="Visitors"
          tableCaption="Deck page to install funnel steps"
          dateRange={props.filters.dateRange}
          showsHashedSplit={readsHashedCohort}
        />
      ) : null}

      {isReady ? (
        <details className="funnel-explainer">
          <summary>How it&rsquo;s counted</summary>
          <div className="funnel-detail-row funnel-explainer-figure"><span>Median page view to install</span><strong>{formatDuration(getMedianInstallSeconds(firstInstallVisits))}</strong></div>
          <p>Every step counts people: a person adds at most one to each step, and counts at a step only after reaching every step above it. Step one is a person who viewed the page of any deck; below it, a person counts at a step when one deck whose page they viewed carried them through every step down to it, so their install click has to be on a deck whose page they viewed. The median page view to install is each person&rsquo;s earliest server install, measured from that deck&rsquo;s page view. Underneath, one row is one visitor identity and one deck version, anchored at that identity&rsquo;s first <code>site_page_viewed</code> of that deck&rsquo;s marketing-site page (<code>page_kind = &apos;catalog_package&apos;</code>) in the selected UTC dates. Step two is a <code>catalog_install_clicked</code> on the same deck version. Every step is joined by that same identity — the shared <code>analytics_visitor</code> cookie the site and the app both send, which resolves to the person&rsquo;s account once the app has linked it to a sign-in — and must arrive within seven days of the page view, each at or after the step above it. Only server-origin <code>catalog_deck_installed</code> is success.</p>
          <p>People count from {catalogInstallFunnelStartDate}, the first full UTC day the site reported identified deck page views, so an earlier range shows a note rather than drop-off. Earlier click-only history is not shown here: this funnel starts at the page view. Pre-consent visits cannot join: where the site has to ask first (the EEA and the UK), a page viewed before the visitor consents carries no visitor id, so it is not in this funnel at all.</p>
          <p>The last three steps read the installing person&rsquo;s reviews anywhere in the product rather than in the installed deck, because <code>review_answered</code> names no deck or card; say so wherever they are quoted. They are counted from the install to seven days after the page view, so a late install leaves less of that window, and the return day is a later UTC day than the install&rsquo;s. A person whose first deck page view is still inside its seven-day window is not a confirmed drop-off.</p>
          <p>The date range, the client platform and the installed deck are read off the anchoring page view; the site always reports as web, so a selection without web empties this funnel. The connection country and the app interface language keep an identity the way they keep a person on General, from their trusted events in the selected dates, so narrowing either keeps only people who signed in. <strong>The placement, source, device category and browser language describe the install click, so they narrow step two and everything below it, never the deck page views above it:</strong> a narrowed selection reads as a lower click rate, not a smaller top. Test-deck rows are excluded, and so is an identity belonging to an <code>@example.com</code> account, an admin or an actor on the analytics exclusion list — reaching backwards over every row of theirs, including the ones sent before they signed in.</p>
          <p>The import-screen, import-confirm, signed-out-gate and confirm-after-sign-in steps come from <code>screen_viewed</code>, which carries no deck, so a visitor who clicked two deck versions in range has those steps satisfied on both rows by the same view. Import confirm is that screen view rather than <code>catalog_install_preview_ready</code>, which marks the same moment: the screen view is reported by the signed-in app with the account&rsquo;s own credential, so it needs no identity link to meet the install.</p>
          <p>&ldquo;Who the funnels count&rdquo; picks the audience. <strong>With anonymous ID</strong>, the default, is everything described above. <strong>Signed-in only</strong> keeps just the visits whose identity resolves to a real, non-guest account at some point up to now, read from a Cognito row in <code>auth.user_identities</code>; it narrows the two no-visit diagnostics the same way, so they stay comparable with the funnel. <strong>All</strong> adds cookieless visitors as the lighter part of the first two bars: where the site may not set a cookie it still reports a daily hash, and one hash on one UTC day is one person. They can reach the deck page view and an install click on a deck whose page they viewed — the same rule as above, on the hash — and nothing below it, because every later step needs an identity the app or the server can meet again. They carry no actor, so the exclusion list, the test-account and admin rules and the delisted <code>test</code> deck&rsquo;s rejection cannot reach them — that last one recognises the fixture by an app-side install start by the same person, which a cookieless browser never sends, and a deck page view carries no deck slug to test instead, so the fixture&rsquo;s own cookieless views and clicks are in these bars. The deck version, the platform, the four click dimensions and their own page view&rsquo;s language still narrow them, and a selected connection country removes them altogether.</p>
          <p><strong>All counts people at most once per cohort, not once per person, so it is an upper bound.</strong> A hash and a cookie are never linked, by design: the daily salt is unreadable and no query may resolve one to the other. Where the site must ask before setting a cookie (the EEA and the UK), the same human sends hashed deck page views before consenting and cookie-bearing ones after, and on that day they can appear once in each part of step one, and of step two, and be added. Nothing here can subtract that overlap, which is why <strong>With anonymous ID</strong> is the default and <strong>All</strong> is a ceiling to read against it rather than a better count.</p>
          <p>A browser that refused consent is given no identifier at all. It is counted only in the <strong>All</strong> audience, through its daily hash, and appears nowhere else here: it holds no visit row, no diagnostic and no median.</p>
          <p><strong>Group by</strong> splits exactly these people and measures each group inside itself: one bar per group at every step, every percentage taken from that group&rsquo;s own first step, and a selected step re-bases each group on its own count there, so two groups of very different size are compared by their rates. Beyond the five largest groups the rest are folded into one <strong>Other</strong>, and everything the selected dimension cannot place is kept in <strong>Unresolved</strong> rather than dropped &mdash; the cookieless visitors of <strong>All</strong> included, who carry neither an identity nor an attributed click and so keep their lighter segment there and only there. Nothing else on this page is grouped: the sign-in branch, the failures, the median, the diagnostics and the maturing warning all stay the whole funnel&rsquo;s. <strong>Only the connection country and the app interface language split these people into groups that add back up to the funnel.</strong> Underneath, one row is one person and one deck version, so under the other five dimensions a person whose deck rows carry different values is counted in two groups and the bars add up to more people than the funnel holds: two deck versions are two groups under <strong>Deck version</strong>; the traffic source and the device category are each row&rsquo;s own deck page view&rsquo;s, so an ordinary browse &mdash; a deck found by search, then the next one reached from inside the site &mdash; is one person under two; and the placement and the browser language are each row&rsquo;s own install click&rsquo;s, so a person who clicked on one deck and not on another is in a value group and in <strong>Unresolved</strong> at once. <strong>Other</strong> is re-counted from the underlying rows rather than by adding those groups up, so it at least stays a count of distinct people. None of the seven is narrowed by the filter field of the same name: the country and the language are the identity&rsquo;s alphabetically first value over the selected dates, and the other five are the row&rsquo;s own while those four filter fields all read the install click, which can be a later session on another device than the page view the row is anchored at &mdash; so a grouped chart can show a country, a language, a source, a device category or a placement that the filter above it did not select. The placement and the browser language exist only on the install click, so every person who never clicked is <strong>Unresolved</strong> under them; the traffic source and the device category are on every row, clicked or not. A <strong>Deck version</strong> bar is named by the slug the deck filter field above shows, and that field lists only versions somebody finished installing, so a deck page nobody has installed from is legended by its raw version id.</p>
        </details>
      ) : null}

      {isReady ? (
        <div className="funnel-detail-grid funnel-detail-grid-collapsible">
          <details className="funnel-detail-card">
            <summary><h3>Signed-out authentication branch</h3></summary>
            {authStages.map((stage) => <div className="funnel-detail-row" key={stage.label}><span>{stage.label}</span><strong>{stage.count.toLocaleString("en-US")} · {formatPercentage(stage.count, authStages[0]?.count ?? 0)}</strong></div>)}
            <p>Denominator: people who reached the signed-out import gate. &ldquo;Signed in on this browser&rdquo; is the first screen view the same browser sent with an account credential after the gate, so it is the person&rsquo;s sign-in rather than this deck&rsquo;s, and a person who already had an account counts only when this browser signed in, not when they used the app elsewhere. It is read from the app rather than from the sign-in page, whose own events reach the account through a link that a first-ever sign-in usually does not complete in time. The sign-in screen and the code request are not shown for the same reason: a person who gave up there can never be matched to their deck page view, so those steps could only count people who went on to succeed. Gate to signed in is therefore the whole sign-in drop-off this report can see.</p>
          </details>
          <details className="funnel-detail-card">
            <summary><h3>Diagnostics</h3></summary>
            <div className="funnel-detail-row"><span>People with a direct-source deck page view (inside denominator)</span><strong>{directVisitorCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Installing people first seen at the deck page view of their first install</span><strong>{newIdentityInstallerCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>Installing people already seen before it</span><strong>{returningIdentityInstallerCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>People with an import preview and no page view of that deck in the selected dates (outside denominator)</span><strong>{previewersWithoutVisitCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>People with a server install and no page view of that deck in the selected dates (outside denominator)</span><strong>{installersWithoutVisitCount.toLocaleString("en-US")}</strong></div>
            <div className="funnel-detail-row"><span>People still inside 7-day window</span><strong>{maturingCount.toLocaleString("en-US")}</strong></div>
            <p>&ldquo;First seen&rdquo; is that identity having produced no trusted event at all before its deck page view, over every event name; rows the credential-free public collector wrote are evidence that an event happened, not evidence that a person exists, and are excluded from that test — including the anchoring page view itself, which is one of them. The two no-visit lines can use the date range, the installed deck, the client platform, the connection country and the app interface language, but none of the click dimensions, which a row with no click carries none of; narrowing placement, source, device category or browser language therefore leaves them wider than the install-click step and the steps below it. A deck page view before the first selected day counts as no visit on both lines, as it does in the funnel. Each is a lower bound on what the funnel cannot hold rather than the whole of it: a person whose click was dropped by a selection, or whose step chain is broken, is equally unheld and counted by neither. A server install carries no platform, so selecting any device platform empties its line.</p>
          </details>
          <details className="funnel-detail-card">
            <summary><h3>Observed failures</h3></summary>
            {failureTotals.length === 0 ? <div className="funnel-detail-row"><span>No failures observed</span><strong>0</strong></div> : failureTotals.map((total) => <div className="funnel-detail-row" key={`${total.stage}:${total.reason}`}><span>{total.stage} · {total.reason}</span><strong>{total.count.toLocaleString("en-US")}</strong></div>)}
            <p>Counts are distinct people per stage/reason; one person may appear in more than one bucket. Missing telemetry is not classified as abandonment.</p>
          </details>
        </div>
      ) : null}
    </section>
  );
}
