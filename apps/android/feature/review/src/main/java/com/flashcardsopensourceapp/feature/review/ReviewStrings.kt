package com.flashcardsopensourceapp.feature.review

import android.content.Context
import android.content.res.Resources
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewIntervalDescription
import com.flashcardsopensourceapp.data.local.notifications.StrictReminderTimeOffset
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

class ReviewTextProvider(
    private val resources: Resources
) {
    val loadingLabel: String
        get() = resources.getString(R.string.review_loading)

    val reviewUpdatedOnAnotherDeviceMessage: String
        get() = resources.getString(R.string.review_updated_on_another_device)

    val reviewCouldNotBeSaved: String
        get() = resources.getString(R.string.review_could_not_be_saved)

    val reviewQueueCouldNotBeLoaded: String
        get() = resources.getString(R.string.review_queue_could_not_be_loaded)

    val speechUnavailableMessage: String
        get() = resources.getString(R.string.review_speech_unavailable)

    val notificationFallbackFrontText: String
        get() = resources.getString(R.string.review_notification_fallback_front_text)

    fun strictReminderBody(timeOffset: StrictReminderTimeOffset): String {
        return when (timeOffset) {
            StrictReminderTimeOffset.FOUR_HOURS -> {
                resources.getString(R.string.review_strict_reminder_body_4h)
            }

            StrictReminderTimeOffset.THREE_HOURS -> {
                resources.getString(R.string.review_strict_reminder_body_3h)
            }

            StrictReminderTimeOffset.TWO_HOURS -> {
                resources.getString(R.string.review_strict_reminder_body_2h)
            }
        }
    }

    fun allCardsTitle(): String = resources.getString(R.string.review_all_cards)

    fun emptyBackTextPlaceholder(): String = resources.getString(R.string.review_no_back_text)

    fun laterSectionTitle(): String = resources.getString(R.string.review_later_section)

    fun intervalDescription(intervalDescription: ReviewIntervalDescription): String {
        return when (intervalDescription) {
            ReviewIntervalDescription.Now -> resources.getString(R.string.review_interval_now)
            ReviewIntervalDescription.LessThanOneMinute -> {
                resources.getString(R.string.review_interval_less_than_one_minute)
            }

            is ReviewIntervalDescription.Minutes -> resources.getQuantityString(
                R.plurals.review_interval_minutes,
                intervalDescription.count,
                intervalDescription.count
            )

            is ReviewIntervalDescription.Hours -> resources.getQuantityString(
                R.plurals.review_interval_hours,
                intervalDescription.count,
                intervalDescription.count
            )

            is ReviewIntervalDescription.Days -> resources.getQuantityString(
                R.plurals.review_interval_days,
                intervalDescription.count,
                intervalDescription.count
            )
        }
    }

    fun effortLabel(effortLevel: EffortLevel): String {
        return when (effortLevel) {
            EffortLevel.FAST -> resources.getString(R.string.review_fast)
            EffortLevel.MEDIUM -> resources.getString(R.string.review_medium)
            EffortLevel.LONG -> resources.getString(R.string.review_long)
        }
    }

    fun tagsLabel(tags: List<String>): String {
        return if (tags.isEmpty()) {
            resources.getString(R.string.review_no_tags_label)
        } else {
            tags.joinToString(separator = ", ")
        }
    }

    fun dueLabel(dueAtMillis: Long?): String {
        if (dueAtMillis == null) {
            return resources.getString(R.string.review_due_new)
        }

        val locale = resources.configuration.locales[0] ?: Locale.getDefault()
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .format(Instant.ofEpochMilli(dueAtMillis).atZone(ZoneId.systemDefault()))
    }

    fun repsLabel(reps: Int): String = resources.getString(R.string.review_reps_label, reps)

    fun lapsesLabel(lapses: Int): String = resources.getString(R.string.review_lapses_label, lapses)

    fun filterTitle(
        selectedFilter: ReviewFilter,
        availableDeckFilters: List<ReviewDeckFilterOption>
    ): String {
        return when (selectedFilter) {
            ReviewFilter.AllCards -> allCardsTitle()
            is ReviewFilter.Deck -> availableDeckFilters.firstOrNull { deck ->
                deck.deckId == selectedFilter.deckId
            }?.title ?: allCardsTitle()

            is ReviewFilter.Effort -> effortLabel(effortLevel = selectedFilter.effortLevel)
            is ReviewFilter.Tag -> selectedFilter.tag
        }
    }
}

fun reviewTextProvider(context: Context): ReviewTextProvider {
    return ReviewTextProvider(resources = context.resources)
}
