package com.flashcardsopensourceapp.core.ui

import android.icu.text.Collator
import android.icu.text.RuleBasedCollator
import java.util.Locale

fun <T> deckNameComparator(
    locale: Locale,
    name: (T) -> String,
    deckId: (T) -> String
): Comparator<T> {
    val collator = (Collator.getInstance(locale) as RuleBasedCollator).apply {
        strength = Collator.SECONDARY
        numericCollation = true
    }
    return Comparator { first, second ->
        val nameOrder = collator.compare(name(first), name(second))
        if (nameOrder == 0) {
            deckId(first).compareTo(deckId(second))
        } else {
            nameOrder
        }
    }
}
