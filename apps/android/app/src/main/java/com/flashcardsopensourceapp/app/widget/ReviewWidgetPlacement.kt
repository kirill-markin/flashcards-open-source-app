package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.compose.ui.unit.DpSize
import androidx.core.content.edit
import androidx.glance.appwidget.GlanceAppWidget
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

private val noWidgetsPlacedCounts = ReviewWidgetPlacementCounts(smallCount = 0, mediumCount = 0, largeCount = 0)

/** The counts this installation last reported per widget kind, cleared on every cloud identity reset. */
class ReviewWidgetPlacementStore(context: Context) {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        reviewWidgetPlacementPreferencesName,
        Context.MODE_PRIVATE
    )

    fun loadLastReportedCounts(kind: WidgetKind): ReviewWidgetPlacementCounts? {
        val smallKey: String = placementCountKey(kind = kind, sizeKey = lastReportedSmallCountKey)
        val mediumKey: String = placementCountKey(kind = kind, sizeKey = lastReportedMediumCountKey)
        val largeKey: String = placementCountKey(kind = kind, sizeKey = lastReportedLargeCountKey)
        val hasReport: Boolean = preferences.contains(smallKey) &&
            preferences.contains(mediumKey) &&
            preferences.contains(largeKey)
        if (hasReport.not()) {
            return null
        }
        return ReviewWidgetPlacementCounts(
            smallCount = preferences.getInt(smallKey, 0),
            mediumCount = preferences.getInt(mediumKey, 0),
            largeCount = preferences.getInt(largeKey, 0)
        )
    }

    fun saveLastReportedCounts(kind: WidgetKind, counts: ReviewWidgetPlacementCounts) {
        preferences.edit(commit = true) {
            putInt(placementCountKey(kind = kind, sizeKey = lastReportedSmallCountKey), counts.smallCount)
            putInt(placementCountKey(kind = kind, sizeKey = lastReportedMediumCountKey), counts.mediumCount)
            putInt(placementCountKey(kind = kind, sizeKey = lastReportedLargeCountKey), counts.largeCount)
        }
    }

    fun clearForIdentityReset() {
        preferences.edit(commit = true) {
            clear()
        }
    }
}

/** Review keeps the unprefixed keys it had when it was the only reported kind, so upgrades do not re-report it. */
private fun placementCountKey(kind: WidgetKind, sizeKey: String): String {
    return if (kind == WidgetKind.REVIEW) sizeKey else "${kind.rawValue}_$sizeKey"
}

/**
 * Reports one `widget_placement_changed` per widget kind whose placed widgets differ from its last
 * report. A Review widget is also reported when it was never reported; any other kind that was never
 * reported counts as none placed. A failed read is logged and skips only that kind.
 */
suspend fun reportReviewWidgetPlacementIfChanged(
    context: Context,
    store: ReviewWidgetPlacementStore,
    analytics: Analytics
) {
    val manager = GlanceAppWidgetManager(context = context)
    WidgetKind.entries.forEach { kind ->
        val counts: ReviewWidgetPlacementCounts = try {
            widgetPlacementCounts(sizes = loadPlacedWidgetSizes(manager = manager, kind = kind))
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.w(
                reviewWidgetPlacementLogTag,
                "event=review_widget_placement_read_failed widgetKind=${kind.rawValue} " +
                    renderSanitizedThrowableLogFields(error = error)
            )
            return@forEach
        }
        val lastReportedCounts: ReviewWidgetPlacementCounts? = store.loadLastReportedCounts(kind = kind)
            ?: if (kind == WidgetKind.REVIEW) null else noWidgetsPlacedCounts
        if (counts == lastReportedCounts) {
            return@forEach
        }
        analytics.track(
            event = AnalyticsEvent.WidgetPlacementChanged(
                smallCount = counts.smallCount,
                mediumCount = counts.mediumCount,
                largeCount = counts.largeCount,
                widgetKind = analyticsWidgetKind(kind = kind)
            )
        )
        store.saveLastReportedCounts(kind = kind, counts = counts)
    }
}

private fun widgetPlacementCounts(sizes: List<ReviewWidgetSize>): ReviewWidgetPlacementCounts {
    return ReviewWidgetPlacementCounts(
        smallCount = sizes.count { size -> size == ReviewWidgetSize.SMALL },
        mediumCount = sizes.count { size -> size == ReviewWidgetSize.MEDIUM },
        largeCount = sizes.count { size -> size == ReviewWidgetSize.LARGE }
    )
}

private suspend fun loadPlacedWidgetSizes(manager: GlanceAppWidgetManager, kind: WidgetKind): List<ReviewWidgetSize> {
    return manager.getGlanceIds(provider = widgetProviderClass(kind = kind)).map { glanceId ->
        portraitWidgetSize(
            kind = kind,
            portraitSize = portraitHostSize(hostSizes = manager.getAppWidgetSizes(glanceId = glanceId))
        )
    }
}

private fun widgetProviderClass(kind: WidgetKind): Class<out GlanceAppWidget> {
    return when (kind) {
        WidgetKind.REVIEW -> ReviewWidget::class.java
        WidgetKind.ACTIVITY -> ActivityWidget::class.java
        WidgetKind.YEAR -> YearWidget::class.java
        WidgetKind.TODAY -> TodayWidget::class.java
        WidgetKind.REVIEWS_CHART -> ReviewsChartWidget::class.java
        WidgetKind.STREAKS -> StreaksWidget::class.java
        WidgetKind.MONTH_CALENDAR -> MonthCalendarWidget::class.java
        WidgetKind.COMING_UP -> ComingUpWidget::class.java
        WidgetKind.DASHBOARD -> DashboardWidget::class.java
        WidgetKind.QUESTION -> QuestionWidget::class.java
    }
}

/**
 * The layout each widget renders at [portraitSize]: `SizeMode.Responsive` widgets render the layout
 * size Glance picks, `SizeMode.Exact` widgets classify the size itself, and a widget with one layout
 * is always that layout.
 */
private fun portraitWidgetSize(kind: WidgetKind, portraitSize: DpSize): ReviewWidgetSize {
    return when (kind) {
        WidgetKind.REVIEW -> reviewWidgetSize(
            size = renderedResponsiveLayoutSize(hostSize = portraitSize, layoutSizes = reviewWidgetSizes)
        )
        WidgetKind.TODAY -> todayWidgetSize(
            size = renderedResponsiveLayoutSize(hostSize = portraitSize, layoutSizes = todayWidgetSizes)
        )
        WidgetKind.QUESTION -> questionWidgetSize(
            size = renderedResponsiveLayoutSize(hostSize = portraitSize, layoutSizes = questionWidgetSizes)
        )
        WidgetKind.ACTIVITY -> activityWidgetSize(layoutSize = portraitSize)
        WidgetKind.REVIEWS_CHART, WidgetKind.COMING_UP -> chartWidgetSize(size = portraitSize)
        WidgetKind.STREAKS -> streaksWidgetSize(widgetSize = portraitSize)
        WidgetKind.MONTH_CALENDAR -> monthCalendarWidgetSize(widgetSize = portraitSize)
        WidgetKind.YEAR, WidgetKind.DASHBOARD -> ReviewWidgetSize.LARGE
    }
}

/**
 * The host size in portrait, the orientation of a phone's home screen: the narrowest host width with
 * the tallest host height, as Glance derives it from the widget options.
 */
private fun portraitHostSize(hostSizes: List<DpSize>): DpSize {
    return DpSize(
        width = hostSizes.minOf { size -> size.width },
        height = hostSizes.maxOf { size -> size.height }
    )
}

/** The layout `SizeMode.Responsive` picks for [hostSize]: the closest that fits, else the smallest. */
private fun renderedResponsiveLayoutSize(hostSize: DpSize, layoutSizes: Set<DpSize>): DpSize {
    return layoutSizes
        .filter { layoutSize -> layoutSize.fitsIn(hostSize = hostSize) }
        .minByOrNull { layoutSize -> squareDistance(first = hostSize, second = layoutSize) }
        ?: layoutSizes.minBy { layoutSize -> layoutSize.width.value * layoutSize.height.value }
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
