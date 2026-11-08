package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.compose.ui.unit.DpSize
import androidx.core.content.edit
import androidx.glance.appwidget.GlanceAppWidgetManager
import com.flashcardsopensourceapp.app.observability.renderSanitizedThrowableLogFields
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import kotlin.math.ceil
import kotlinx.coroutines.CancellationException

private const val reviewWidgetPlacementPreferencesName: String = "review_widget_placement"
private const val lastReportedSmallCountKey: String = "last_reported_small_count"
private const val lastReportedMediumCountKey: String = "last_reported_medium_count"
private const val lastReportedLargeCountKey: String = "last_reported_large_count"
private const val reviewWidgetPlacementLogTag: String = "FlashcardsReviewWidget"

data class ReviewWidgetPlacementCounts(
    val smallCount: Int,
    val mediumCount: Int,
    val largeCount: Int
)

/** The counts this installation last reported, cleared on every cloud identity reset. */
class ReviewWidgetPlacementStore(context: Context) {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        reviewWidgetPlacementPreferencesName,
        Context.MODE_PRIVATE
    )

    fun loadLastReportedCounts(): ReviewWidgetPlacementCounts? {
        val hasReport: Boolean = preferences.contains(lastReportedSmallCountKey) &&
            preferences.contains(lastReportedMediumCountKey) &&
            preferences.contains(lastReportedLargeCountKey)
        if (hasReport.not()) {
            return null
        }
        return ReviewWidgetPlacementCounts(
            smallCount = preferences.getInt(lastReportedSmallCountKey, 0),
            mediumCount = preferences.getInt(lastReportedMediumCountKey, 0),
            largeCount = preferences.getInt(lastReportedLargeCountKey, 0)
        )
    }

    fun saveLastReportedCounts(counts: ReviewWidgetPlacementCounts) {
        preferences.edit(commit = true) {
            putInt(lastReportedSmallCountKey, counts.smallCount)
            putInt(lastReportedMediumCountKey, counts.mediumCount)
            putInt(lastReportedLargeCountKey, counts.largeCount)
        }
    }

    fun clearForIdentityReset() {
        preferences.edit(commit = true) {
            clear()
        }
    }
}

/**
 * Reports `widget_placement_changed` when the placed Review widgets differ from the last report, and
 * always when there is none. A failed read is logged and reports nothing.
 */
suspend fun reportReviewWidgetPlacementIfChanged(
    context: Context,
    store: ReviewWidgetPlacementStore,
    analytics: Analytics
) {
    val counts: ReviewWidgetPlacementCounts = try {
        reviewWidgetPlacementCounts(sizes = loadPlacedReviewWidgetSizes(context = context))
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        Log.w(
            reviewWidgetPlacementLogTag,
            "event=review_widget_placement_read_failed ${renderSanitizedThrowableLogFields(error = error)}"
        )
        return
    }
    if (counts == store.loadLastReportedCounts()) {
        return
    }
    analytics.track(
        event = AnalyticsEvent.WidgetPlacementChanged(
            smallCount = counts.smallCount,
            mediumCount = counts.mediumCount,
            largeCount = counts.largeCount
        )
    )
    store.saveLastReportedCounts(counts = counts)
}

private fun reviewWidgetPlacementCounts(sizes: List<ReviewWidgetSize>): ReviewWidgetPlacementCounts {
    return ReviewWidgetPlacementCounts(
        smallCount = sizes.count { size -> size == ReviewWidgetSize.SMALL },
        mediumCount = sizes.count { size -> size == ReviewWidgetSize.MEDIUM },
        largeCount = sizes.count { size -> size == ReviewWidgetSize.LARGE }
    )
}

private suspend fun loadPlacedReviewWidgetSizes(context: Context): List<ReviewWidgetSize> {
    val manager = GlanceAppWidgetManager(context = context)
    return manager.getGlanceIds(provider = ReviewWidget::class.java).map { glanceId ->
        renderedPortraitReviewWidgetSize(hostSizes = manager.getAppWidgetSizes(glanceId = glanceId))
    }
}

/**
 * The size a widget renders at in portrait, the orientation of a phone's home screen. Portrait is the
 * narrowest host width with the tallest host height, as Glance derives it from the widget options,
 * and the layout is the one `SizeMode.Responsive` picks for it: the closest that fits, else the
 * smallest.
 */
private fun renderedPortraitReviewWidgetSize(hostSizes: List<DpSize>): ReviewWidgetSize {
    val portraitSize = DpSize(
        width = hostSizes.minOf { size -> size.width },
        height = hostSizes.maxOf { size -> size.height }
    )
    val renderedSize: DpSize = reviewWidgetSizes
        .filter { layoutSize -> layoutSize.fitsIn(hostSize = portraitSize) }
        .minByOrNull { layoutSize -> squareDistance(first = portraitSize, second = layoutSize) }
        ?: reviewWidgetSizes.minBy { layoutSize -> layoutSize.width.value * layoutSize.height.value }
    return reviewWidgetSize(size = renderedSize)
}

/** Glance's fit test, which tolerates a host size up to 1 dp short of the layout. */
private fun DpSize.fitsIn(hostSize: DpSize): Boolean {
    return ceil(hostSize.width.value) + 1 > width.value && ceil(hostSize.height.value) + 1 > height.value
}

private fun squareDistance(first: DpSize, second: DpSize): Float {
    val widthDistance: Float = first.width.value - second.width.value
    val heightDistance: Float = first.height.value - second.height.value
    return widthDistance * widthDistance + heightDistance * heightDistance
}
