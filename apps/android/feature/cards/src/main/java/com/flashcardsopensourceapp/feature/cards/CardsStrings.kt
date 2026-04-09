package com.flashcardsopensourceapp.feature.cards

import android.content.Context
import android.content.res.Resources
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

data class CardsTextProvider(
    val cardsUpdatedOnAnotherDeviceMessage: String,
    val newCardTitle: String,
    val editCardTitle: String,
    val enterTagBeforeAdding: String,
    val frontTextRequired: String,
    val backTextRequired: String
)

fun cardsTextProvider(context: Context): CardsTextProvider {
    return CardsTextProvider(
        cardsUpdatedOnAnotherDeviceMessage = context.getString(R.string.cards_updated_on_another_device),
        newCardTitle = context.getString(R.string.cards_new_card_title),
        editCardTitle = context.getString(R.string.cards_edit_card_title),
        enterTagBeforeAdding = context.getString(R.string.cards_enter_tag_before_adding),
        frontTextRequired = context.getString(R.string.cards_front_text_required),
        backTextRequired = context.getString(R.string.cards_back_text_required)
    )
}

fun formatCardsTextPreview(resources: Resources, text: String): String {
    val trimmedText = text.trim()

    if (trimmedText.isEmpty()) {
        return resources.getString(R.string.cards_text_preview_placeholder)
    }

    return trimmedText
        .split('\n')
        .joinToString(separator = " ")
}

fun formatCardsTagSelectionSummary(resources: Resources, tags: List<String>): String {
    if (tags.isEmpty()) {
        return resources.getString(R.string.cards_no_tags_selected)
    }

    return tags.joinToString(separator = ", ")
}

fun formatCardsEffortLevelTitle(resources: Resources, effortLevel: EffortLevel): String {
    return when (effortLevel) {
        EffortLevel.FAST -> resources.getString(R.string.cards_fast)
        EffortLevel.MEDIUM -> resources.getString(R.string.cards_medium)
        EffortLevel.LONG -> resources.getString(R.string.cards_long)
    }
}

fun formatCardsTagsLabel(resources: Resources, tags: List<String>): String {
    return if (tags.isEmpty()) {
        resources.getString(R.string.cards_no_tags_label)
    } else {
        tags.joinToString(separator = ", ")
    }
}

fun formatCardsDueLabel(resources: Resources, dueAtMillis: Long?): String {
    if (dueAtMillis == null) {
        return resources.getString(R.string.cards_due_new)
    }

    val locale = resources.configuration.locales[0] ?: Locale.getDefault()
    return DateTimeFormatter
        .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(locale)
        .format(Instant.ofEpochMilli(dueAtMillis).atZone(ZoneId.systemDefault()))
}

fun formatCardsMetadataSummary(resources: Resources, card: CardSummary): String {
    return listOf(
        formatCardsEffortLevelTitle(resources = resources, effortLevel = card.effortLevel),
        formatCardsTagsLabel(resources = resources, tags = card.tags),
        formatCardsDueLabel(resources = resources, dueAtMillis = card.dueAtMillis)
    ).joinToString(separator = " | ")
}

fun formatCardsFilterSummary(resources: Resources, filter: CardFilter): String {
    val parts = buildList {
        if (filter.effort.isNotEmpty()) {
            add(
                resources.getString(
                    R.string.cards_filter_summary_effort,
                    filter.effort.joinToString(separator = ", ") { effortLevel ->
                        formatCardsEffortLevelTitle(resources = resources, effortLevel = effortLevel)
                    }
                )
            )
        }
        if (filter.tags.isNotEmpty()) {
            add(
                resources.getString(
                    R.string.cards_filter_summary_tags,
                    filter.tags.joinToString(separator = ", ")
                )
            )
        }
    }

    return parts.joinToString(separator = " • ")
}
