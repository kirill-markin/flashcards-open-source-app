import type { TranslationKey } from "../i18n";
import type { DateTimeValue, TranslationValues } from "../i18n/types";
import type { CardFilter, DeckFilterDefinition, EffortLevel } from "../types";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type FormatDateTime = (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;

const EMPTY_LIST_PLACEHOLDER = "\u2014";

function effortLevelTranslationKey(
  effortLevel: EffortLevel,
): "effortLevels.fast" | "effortLevels.medium" | "effortLevels.long" {
  if (effortLevel === "fast") {
    return "effortLevels.fast";
  }

  if (effortLevel === "medium") {
    return "effortLevels.medium";
  }

  return "effortLevels.long";
}

function joinFilterSummaryParts(parts: ReadonlyArray<string>, t: Translate): string {
  if (parts.length === 0) {
    return t("filters.none");
  }

  return parts.join(` ${t("filters.and")} `);
}

export function formatEffortLevelLabel(t: Translate, effortLevel: EffortLevel): string {
  return t(effortLevelTranslationKey(effortLevel));
}

export function formatNullableDateTime(
  value: string | null,
  formatDateTime: FormatDateTime,
  t: Translate,
): string {
  if (value === null) {
    return t("common.newItem");
  }

  return formatDateTime(value);
}

export function formatTagSummary(tags: ReadonlyArray<string>): string {
  if (tags.length === 0) {
    return EMPTY_LIST_PLACEHOLDER;
  }

  return tags.join(", ");
}

export function formatDeckFilterSummary(
  filterDefinition: DeckFilterDefinition,
  t: Translate,
): string {
  const parts: Array<string> = [];

  if (filterDefinition.effortLevels.length > 0) {
    parts.push(t("filters.effortIn", {
      values: filterDefinition.effortLevels.map((effortLevel) => formatEffortLevelLabel(t, effortLevel)).join(", "),
    }));
  }

  if (filterDefinition.tags.length > 0) {
    parts.push(t("filters.tagsAnyOf", {
      values: filterDefinition.tags.join(", "),
    }));
  }

  if (parts.length === 0) {
    return t("filters.allCards");
  }

  return joinFilterSummaryParts(parts, t);
}

export function formatCardFilterSummary(
  filter: CardFilter | null,
  t: Translate,
): string {
  if (filter === null) {
    return t("filters.none");
  }

  const parts: Array<string> = [];

  if (filter.effort.length > 0) {
    parts.push(t("filters.effortIn", {
      values: filter.effort.map((effortLevel) => formatEffortLevelLabel(t, effortLevel)).join(", "),
    }));
  }

  if (filter.tags.length > 0) {
    parts.push(t("filters.tagsAnyOf", {
      values: filter.tags.join(", "),
    }));
  }

  return joinFilterSummaryParts(parts, t);
}
