import { useEffect, useMemo, useState, type JSX } from "react";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import { isFunnelHashedCohortRead, isFunnelHashedSplitShown } from "../funnels/funnelAudienceSql";
import type { FunnelAnchor } from "../funnels/funnelAnchorUrl";
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
  const authStages = useMemo(() => buildAuthStages(visits), [visits]);
  const failureTotals = useMemo(() => buildFailureTotals(visits), [visits]);

  const firstInstallVisits = useMemo(() => getFirstInstallVisitByPerson(visits), [visits]);

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
  const wantsHashedCohort = isFunnelHashedSplitShown(props.filters);
  // What the query actually read, which is what every sentence and column about the cookieless
  // segment is chosen on: with a country selected the mode is still `all` and the cohort is not read.
  const readsHashedCohort = isFunnelHashedCohortRead(props.filters);
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

      {props.isRangeLoading || loadState.status === "loading" ? <div className="report-state" aria-live="polite">Loading deck page to install funnel…</div> : null}
      {props.isRangeLoading === false && loadState.status === "error" ? <div className="report-state report-state-error"><strong>Funnel query failed.</strong><span>{loadState.message}</span><button className="filter-button" type="button" onClick={() => setLoadRevision((revision) => revision + 1)}>Retry</button></div> : null}
      {startDateNote !== null ? <p className="report-state" aria-live="polite">{startDateNote}</p> : null}
      {hashedCountryNote !== null ? <p className="report-state" aria-live="polite">{hashedCountryNote}</p> : null}
      {/* Chosen on the read gate, not the mode: with a country selected the cookieless rows were not read, and the note above already says so. */}
      {isReady && hasVisits === false ? <div className="report-state"><strong>No deck page views match these filters.</strong><span>{readsHashedCohort ? "Cookieless visitors are counted here through their daily hash, so this is every deck page view in range, and no earlier traffic history is inferred from Vercel aggregates." : "A page view from a browser that refused consent carries no identity and is not counted, and no earlier traffic history is inferred from Vercel aggregates."}</span></div> : null}

      {/* The window belongs to the people who have one, so the denominator is the identified part of the first step. */}
      {isReady ? <FunnelMaturingWarning maturingCount={maturingCount} entryCount={(mainStages[0]?.count ?? 0) - (mainStages[0]?.hashedCount ?? 0)} /> : null}

      {hasVisits ? (
        <FunnelStepsChart
          anchor={catalogInstallFunnelAnchor}
          stages={mainStages}
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
