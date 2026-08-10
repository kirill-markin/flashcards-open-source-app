import type { TranslationKey } from "../../i18n";
import type { DateTimeValue, TranslationValues } from "../../i18n/types";
import type { CardFilter, DeckFilterDefinition } from "../../types";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type FormatDateTime = (value: DateTimeValue, options?: Readonly<Intl.DateTimeFormatOptions>) => string;

function joinFilterSummaryParts(parts: ReadonlyArray<string>, t: Translate): string {
  if (parts.length === 0) {
    return t("filters.none");
  }

  return parts.join(` ${t("filters.and")} `);
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

export function formatTagSummary(tags: ReadonlyArray<string>, t: Translate): string {
  if (tags.length === 0) {
    return t("common.noTags");
  }

  return tags.join(", ");
}

export function formatDeckFilterSummary(
  filterDefinition: DeckFilterDefinition,
  t: Translate,
): string {
  const parts: Array<string> = [];

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

  if (filter.tags.length > 0) {
    parts.push(t("filters.tagsAnyOf", {
      values: filter.tags.join(", "),
    }));
  }

  return joinFilterSummaryParts(parts, t);
}
