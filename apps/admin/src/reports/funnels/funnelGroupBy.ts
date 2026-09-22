// The group-by axis of the Funnels area: what a dimension is, how the selected one rides in the URL,
// how the groups a funnel loaded are folded down to the handful a chart can draw, and what colour
// each of them gets. Every funnel declares its own dimensions and owns the SQL behind them; this
// module owns everything about grouping that must mean the same thing on all of them.
//
// GROUPING IS A SECOND AXIS BESIDE THE AUDIENCE MODE, not a replacement for it. The mode
// (`./funnelAudienceSql.ts`) decides who is counted; grouping splits exactly those people, one group
// per person, and every group's conversions are then measured inside that group: its own first step
// is its denominator, and a selected anchor re-bases each group on its own count at that step. A
// group's share is therefore never a share of the funnel as a whole, which is the whole point of the
// field - two groups of very different size are compared by their rates rather than by their heights.

import {
  getFunnelGroupColorScale,
  getPlatformColor,
  getPlatformLabel,
  isReviewEventPlatform,
  neutralChartColor,
} from "../../charts/chartPrimitives";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import type { FunnelStage } from "./FunnelStepsChart";

/**
 * All the shared helpers below need of a dimension: the stable URL token and the name on screen.
 *
 * `id` is never the label, so a dimension can be renamed on screen without breaking links that are
 * already shared. Where a funnel's key comes from is the funnel's own business, which is why nothing
 * here knows about it: a funnel reduced in SQL declares `FunnelGroupByDimension` below, while one
 * whose query already returns a row per person reduces in the browser and declares its own dimension
 * type over this one, carrying a reader instead.
 */
export type FunnelGroupByField = Readonly<{
  id: string;
  label: string;
}>;

/**
 * One thing a funnel reduced in SQL can be grouped by.
 *
 * `buildGroupKeySql` returns one SQL expression that yields exactly one group key per counted person,
 * so the funnel's steps stay a partition of its cohort and the groups still sum to the funnel. NULL
 * is a legal result and is the dimension saying it cannot place that person: the funnel's query folds
 * it into `unresolvedFunnelGroupKey` rather than dropping the person.
 */
export type FunnelGroupByDimension = FunnelGroupByField & Readonly<{
  buildGroupKeySql: (filters: AnalyticsFilterState) => string;
}>;

/**
 * The id every funnel's platform dimension has to use. Its keys are
 * `analytics.product_events_resolved.platform` values, and that is what lets its colours come from
 * the dashboard-wide platform palette instead of a positional one, so a colour means the same
 * platform here as on every other chart.
 */
export const platformFunnelGroupByDimensionId = "platform";

/**
 * The key a funnel gives a person its selected dimension cannot place, as a plain literal because a
 * funnel reduced in SQL produces it there. Almost no dimension value can be this word: platforms,
 * ISO country codes and UI locales are all shorter, fixed shapes - `ui_locale` is constrained to
 * one by `db/migrations/0137_audience_context.sql`.
 *
 * THE ONE EXCEPTION IS A DIMENSION KEYED ON `device_locale`, which the deck funnel's browser
 * language at click is: that column is unconstrained client text up to 200 characters in the same
 * migration, so a client that reports exactly this word merges into the pinned `Unresolved` group,
 * out of the five drawn ones and in with the counts no dimension could place. It is recorded here
 * rather than worked around because it costs one misplaced group of one absurd value, and a wider
 * sentinel would have to be produced identically by every funnel's SQL. A new dimension keyed on
 * free client text belongs in this note.
 */
export const unresolvedFunnelGroupKey = "unresolved";

/** `Unresolved` is a measured group with no value, not a missing one, so it says so on screen. */
const unresolvedFunnelGroupLabel = "Unresolved";

/**
 * The folded remainder's key. It is a chart-side key that no SQL ever produces, deliberately in a
 * shape no dimension value takes, so a real value spelled "other" keeps its own group.
 */
export const otherFunnelGroupKey = "__other__";

/**
 * The most value groups a chart draws before the rest are folded into one.
 *
 * Five plus the remainder plus `Unresolved` is seven bars inside one step band, which is what the
 * step column still reads as at the chart's width; more than that and neither the bars nor the legend
 * can be told apart. `Unresolved` never takes one of these slots, because dropping it into the
 * remainder would hide the coverage of the dimension itself behind a bar that means something else.
 */
const maxFunnelValueGroupCount = 5;

/** One loaded group, before folding: the funnel's full step list for the people in that group. */
export type FunnelGroupCounts<StepId extends string> = Readonly<{
  key: string;
  label: string;
  stages: ReadonlyArray<FunnelStage<StepId>>;
}>;

/** One group as the chart draws it. */
export type FunnelGroup<StepId extends string> = Readonly<{
  key: string;
  label: string;
  color: string;
  stages: ReadonlyArray<FunnelStage<StepId>>;
}>;

/** The picker's `None` option value; the empty string can never collide with a dimension id. */
export const funnelGroupByNoneValue = "";

function getFunnelGroupByParamName(funnelId: string): string {
  return `${funnelId}GroupBy`;
}

/**
 * The dimension a query string asks this funnel for, or `null` for the ungrouped default.
 *
 * It follows the anchor codec in `./funnelAnchorUrl.ts`: the parameter is the funnel's own, so
 * grouping one chart leaves the others alone, and anything the funnel does not offer - an unknown,
 * repeated or empty value - reads back as the default rather than throwing. There is deliberately no
 * legacy name here the way the deck funnel's anchor has one: the field is new on every funnel.
 */
export function parseFunnelGroupByDimension<Dimension extends FunnelGroupByField>(
  searchParams: URLSearchParams,
  funnelId: string,
  dimensions: ReadonlyArray<Dimension>,
): Dimension | null {
  const value = readFunnelGroupByParam(searchParams, funnelId);
  return dimensions.find((dimension) => dimension.id === value) ?? null;
}

/**
 * The raw value a query string carries for this funnel, or `null` for none.
 *
 * The area's URL canonicalizer in `App.tsx` reads it to carry the field over a filter change without
 * knowing what it means: the option list is per funnel and lives with the funnel, so the funnel is
 * what validates the value, and an unknown one is kept in the URL while the funnel opens ungrouped.
 */
export function readFunnelGroupByParam(searchParams: URLSearchParams, funnelId: string): string | null {
  const values = searchParams.getAll(getFunnelGroupByParamName(funnelId));
  return values.length === 1 ? (values[0] ?? null) : null;
}

/** A copy of `searchParams` carrying `dimensionId` for this funnel, or nothing for the default. */
export function withFunnelGroupBySearchParams(
  searchParams: URLSearchParams,
  funnelId: string,
  dimensionId: string | null,
): URLSearchParams {
  const paramName = getFunnelGroupByParamName(funnelId);
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete(paramName);
  if (dimensionId !== null && dimensionId !== funnelGroupByNoneValue) {
    nextSearchParams.set(paramName, dimensionId);
  }

  return nextSearchParams;
}

/**
 * Writes the selected dimension into the current URL the way the anchor is written: it replaces the
 * current history entry rather than pushing one, so Back leaves the area instead of stepping through
 * every pick, and every other parameter is kept as it is.
 */
export function writeFunnelGroupByToUrl(funnelId: string, dimensionId: string | null): void {
  const searchParams = withFunnelGroupBySearchParams(
    new URLSearchParams(window.location.search),
    funnelId,
    dimensionId,
  );
  const serializedParams = searchParams.toString();
  const nextSearch = serializedParams === "" ? "" : `?${serializedParams}`;
  if (nextSearch === window.location.search) {
    return;
  }

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${nextSearch}${window.location.hash}`,
  );
}

/**
 * One group's colour, as an accessor over the resolved keys a chart draws.
 *
 * The platform dimension reuses the dashboard's platform palette, so a colour means the same platform
 * on a funnel as on every other chart. Every other dimension is an open-ended set the dashboard only
 * learns from the loaded range, so its colours are positional over the sorted keys, exactly as the
 * catalog decks' are. Build it from the keys that survive folding rather than from every key the
 * report returned: a dimension like the connection country returns far more keys over a wide range
 * than the palette has colours, so a scale over all of them gives two of the drawn groups one colour
 * whenever their sorted positions are a palette apart, and the legend stops telling them apart. At
 * most five keys reach this scale, so that can never happen; the price is that a sixth group
 * appearing recolours the ones sorted after it, which is the cheaper loss with the legend beside the
 * chart.
 */
export function buildFunnelGroupColor(
  dimension: FunnelGroupByField,
  drawnGroupKeys: ReadonlyArray<string>,
): (groupKey: string) => string {
  if (dimension.id === platformFunnelGroupByDimensionId) {
    // NEITHER THIS NOR THE LABEL BELOW MAY THROW ON A KEY THEY DO NOT KNOW, because every funnel
    // inherits this path and a throw here is a throw during render, with no error boundary anywhere
    // in this app to catch it. A dimension's keys and the dimension selected can disagree for one
    // render - a picked dimension is on screen before its report is - and a platform dimension that
    // one day emits a key outside the fixed list must draw grey rather than blank the dashboard.
    return (groupKey: string): string => (
      isReviewEventPlatform(groupKey) ? getPlatformColor(groupKey) : neutralChartColor
    );
  }

  const colorScale = getFunnelGroupColorScale(drawnGroupKeys);
  return (groupKey: string): string => colorScale(groupKey);
}

/**
 * A group's name on screen, for every funnel.
 *
 * A key of any other dimension is shown as the value the events carry - an ISO country code, a UI
 * locale - which is what the filter bar and the Audience report show, so the same value reads the
 * same way in both places; a platform takes its dashboard-wide name, and falls back to its raw key
 * rather than throwing, for the reason `buildFunnelGroupColor` above does.
 */
export function buildFunnelGroupLabel(dimension: FunnelGroupByField, groupKey: string): string {
  // The pinned group has no value to name, and `foldFunnelGroups` gives it its own label anyway.
  if (groupKey === unresolvedFunnelGroupKey) {
    return groupKey;
  }

  if (dimension.id !== platformFunnelGroupByDimensionId || isReviewEventPlatform(groupKey) === false) {
    return groupKey;
  }

  return getPlatformLabel(groupKey);
}

/**
 * Both counts fold by summing, which is exact only where every counted person carries exactly one
 * group key, so that no person is in two of the groups being added. That is the rule for a funnel
 * whose groups partition its cohort, and it is why merging the remainder is a caller's decision in
 * `foldFunnelGroupsWith` rather than this function's alone.
 */
function sumFunnelStages<StepId extends string>(
  stageLists: ReadonlyArray<ReadonlyArray<FunnelStage<StepId>>>,
): ReadonlyArray<FunnelStage<StepId>> {
  const [firstStages, ...remainingStages] = stageLists;
  if (firstStages === undefined) {
    throw new Error("Folding funnel groups needs at least one group to sum.");
  }

  return firstStages.map((stage, index) => remainingStages.reduce((summedStage, stages) => {
    const addedStage = stages[index];
    if (addedStage === undefined || addedStage.id !== stage.id) {
      throw new Error(`Funnel group step "${stage.id}" is missing from a group being folded.`);
    }

    return {
      ...summedStage,
      count: summedStage.count + addedStage.count,
      hashedCount: summedStage.hashedCount + addedStage.hashedCount,
    };
  }, stage));
}

/**
 * The groups a chart draws, from the groups a funnel loaded.
 *
 * Value groups are ranked by how many people entered them - their own first step - and the top five
 * are kept; everything below is summed into one grey `Other`, which keeps the chart readable without
 * hiding those people from the funnel's totals. `Unresolved` is pinned beside them: it is never
 * folded and never competes for one of the five, because how much of the cohort a dimension cannot
 * place is a fact about the dimension that the reader has to see next to the values.
 */
export function foldFunnelGroups<StepId extends string>(
  dimension: FunnelGroupByField,
  groups: ReadonlyArray<FunnelGroupCounts<StepId>>,
): ReadonlyArray<FunnelGroup<StepId>> {
  return foldFunnelGroupsWith(dimension, groups, (foldedGroups) => (
    sumFunnelStages(foldedGroups.map((group) => group.stages))
  ));
}

/**
 * The same folding for a funnel whose groups can hold one person twice, which decides `Other` for
 * itself.
 *
 * `mergeFoldedStages` is handed the groups below the five drawn and returns the one stage list that
 * replaces them. A funnel whose groups partition its cohort sums them, through `foldFunnelGroups`
 * above. The deck funnel grouped by deck version cannot: a person's rows are one per deck they
 * viewed, so the same person can sit in two folded groups and a sum would count them twice; it
 * re-reduces the underlying rows instead. Everything else about the fold - the ranking, the five,
 * the pinned `Unresolved` and the colours - is the same on every funnel, which is the point of
 * having one function.
 */
export function foldFunnelGroupsWith<
  StepId extends string,
  Group extends FunnelGroupCounts<StepId>,
>(
  dimension: FunnelGroupByField,
  groups: ReadonlyArray<Group>,
  mergeFoldedStages: (foldedGroups: ReadonlyArray<Group>) => ReadonlyArray<FunnelStage<StepId>>,
): ReadonlyArray<FunnelGroup<StepId>> {
  const resolvedGroups = groups.filter((group) => group.key !== unresolvedFunnelGroupKey);
  const unresolvedGroup = groups.find((group) => group.key === unresolvedFunnelGroupKey);
  const rankedGroups = [...resolvedGroups].sort((leftGroup, rightGroup) => (
    (rightGroup.stages[0]?.count ?? 0) - (leftGroup.stages[0]?.count ?? 0)
      || leftGroup.label.localeCompare(rightGroup.label)
  ));
  const drawnGroups = rankedGroups.slice(0, maxFunnelValueGroupCount);
  const foldedGroups = rankedGroups.slice(maxFunnelValueGroupCount);
  const getGroupColor = buildFunnelGroupColor(dimension, drawnGroups.map((group) => group.key));

  return [
    ...drawnGroups.map((group) => ({
      key: group.key,
      label: group.label,
      color: getGroupColor(group.key),
      stages: group.stages,
    })),
    ...(foldedGroups.length === 0 ? [] : [{
      key: otherFunnelGroupKey,
      // The count is in the label because the bar itself cannot say how many values it holds.
      label: `Other (${foldedGroups.length})`,
      color: neutralChartColor,
      stages: mergeFoldedStages(foldedGroups),
    }]),
    ...(unresolvedGroup === undefined ? [] : [{
      key: unresolvedFunnelGroupKey,
      label: unresolvedFunnelGroupLabel,
      color: neutralChartColor,
      stages: unresolvedGroup.stages,
    }]),
  ];
}
