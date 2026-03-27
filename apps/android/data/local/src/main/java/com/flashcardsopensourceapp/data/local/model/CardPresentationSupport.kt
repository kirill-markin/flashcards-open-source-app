package com.flashcardsopensourceapp.data.local.model

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

fun formatCardEffortLabel(effortLevel: EffortLevel): String {
    return effortLevel.name.lowercase().replaceFirstChar { character ->
        character.uppercase()
    }
}

fun formatCardTagsLabel(tags: List<String>): String {
    return if (tags.isEmpty()) {
        "No tags"
    } else {
        tags.joinToString(separator = ", ")
    }
}

fun formatCardDueLabel(dueAtMillis: Long?): String {
    if (dueAtMillis == null) {
        return "new"
    }

    return DateTimeFormatter
        .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(Locale.getDefault())
        .format(Instant.ofEpochMilli(dueAtMillis).atZone(ZoneId.systemDefault()))
}
