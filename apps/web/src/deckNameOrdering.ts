import type { Locale } from "./i18n/types";
import type { DeckSummary } from "./types";

type NamedDeck = Pick<DeckSummary, "deckId" | "name">;

export function createDeckNameComparator(locale: Locale): (left: NamedDeck, right: NamedDeck) => number {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "accent" });
  return (left: NamedDeck, right: NamedDeck): number => {
    const nameOrder = collator.compare(left.name, right.name);
    if (nameOrder !== 0) {
      return nameOrder;
    }

    return left.deckId < right.deckId ? -1 : left.deckId > right.deckId ? 1 : 0;
  };
}
