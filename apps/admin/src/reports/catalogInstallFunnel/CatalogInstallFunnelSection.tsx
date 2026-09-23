import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { buildFunnelAudienceEmptyStateNote, type AnalyticsFilterState } from "../../filters/analyticsFilters";
import { isFunnelAllAudienceSelected, isFunnelHashedCohortRead } from "../funnels/funnelAudienceSql";
import { FunnelGroupByPicker } from "../funnels/FunnelGroupByPicker";
import { parseFunnelGroupByDimension, writeFunnelGroupByToUrl } from "../funnels/funnelGroupBy";
import { FunnelMaturingWarning } from "../funnels/FunnelMaturingWarning";
import type { FunnelSectionProps } from "../funnels/funnelSections";
import { formatPercentage, FunnelStepsChart } from "../funnels/FunnelStepsChart";
import {
  catalogInstallFunnelStartDate,
  loadCatalogInstallFunnelReport,
  type CatalogInstallFunnelReport,
} from "./query";
import {
  buildCatalogInstallFunnelReportModel,
  catalogInstallFunnelAnchor,
  catalogInstallFunnelGroupByDimensions,
  type CatalogInstallFunnelGroupByDimension,
} from "./reportModel";

export { catalogInstallFunnelAnchor } from "./reportModel";
export const catalogInstallFunnelTitle = "Deck page to install";

type FunnelLoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; report: CatalogInstallFunnelReport }>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected deck page to install funnel error.";
}

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
  const {
    mainStages,
    groups,
    authStages,
    failureTotals,
    medianInstallSeconds,
    newIdentityInstallerCount,
    returningIdentityInstallerCount,
    directVisitorCount,
    maturingCount,
    maturityEntryCount,
    previewersWithoutVisitCount,
    installersWithoutVisitCount,
    hasVisits: reportHasVisits,
  } = useMemo(
    () => buildCatalogInstallFunnelReportModel(report, groupByDimension?.id ?? null, props.catalogDeckOptions),
    [report, groupByDimension, props.catalogDeckOptions],
  );
  // A pick regroups rows the browser already holds, so nothing reloads and the URL is all that is
  // written back beside the state.
  const selectGroupByDimension = useCallback(
    (dimension: CatalogInstallFunnelGroupByDimension | null): void => {
      setGroupByDimension(dimension);
      writeFunnelGroupByToUrl(catalogInstallFunnelAnchor.funnelId, dimension?.id ?? null);
    },
    [],
  );

  const isReady = props.isRangeLoading === false && loadState.status === "ready";
  const hasVisits = isReady && reportHasVisits;
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

      {isReady ? <FunnelMaturingWarning maturingCount={maturingCount} entryCount={maturityEntryCount} /> : null}

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
          <div className="funnel-detail-row funnel-explainer-figure"><span>Median page view to install</span><strong>{formatDuration(medianInstallSeconds)}</strong></div>
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
