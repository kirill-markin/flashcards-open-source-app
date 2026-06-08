package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import java.time.LocalDate
import java.time.format.DateTimeParseException

internal fun parseLocalDate(
    rawDate: String
): LocalDate {
    return try {
        LocalDate.parse(rawDate)
    } catch (error: DateTimeParseException) {
        throw IllegalArgumentException("Invalid local date '$rawDate'.", error)
    }
}

internal fun createInclusiveLocalDateRange(
    from: String,
    to: String
): List<String> {
    val startDate = parseLocalDate(rawDate = from)
    val endDate = parseLocalDate(rawDate = to)
    val dates = mutableListOf<String>()
    var currentDate = startDate

    while (currentDate <= endDate) {
        dates.add(currentDate.toString())
        currentDate = currentDate.plusDays(1L)
    }

    return dates
}

internal fun computeCurrentStreakDays(
    activeReviewDateSet: Set<String>,
    today: LocalDate
): Int {
    val anchorDate: LocalDate = when {
        activeReviewDateSet.contains(today.toString()) -> today
        activeReviewDateSet.contains(today.minusDays(1L).toString()) -> today.minusDays(1L)
        else -> return 0
    }

    var streakDays = 0
    var currentDate = anchorDate
    while (activeReviewDateSet.contains(currentDate.toString())) {
        streakDays += 1
        currentDate = currentDate.minusDays(1L)
    }
    return streakDays
}

internal fun isLocalDateAfter(
    first: String?,
    second: String?
): Boolean {
    return when {
        first == null -> false
        second == null -> true
        else -> parseLocalDate(rawDate = first).isAfter(parseLocalDate(rawDate = second))
    }
}

internal fun maxLocalDate(
    first: String?,
    second: String?
): String? {
    return when {
        first == null -> second
        second == null -> first
        parseLocalDate(rawDate = first).isAfter(parseLocalDate(rawDate = second)) -> first
        else -> second
    }
}
