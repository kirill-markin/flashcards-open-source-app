package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.components.Scaffold
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.R
import java.time.LocalDate

/** Narrower widgets get the small layout. */
private val activityWidgetMediumMinWidth = 220.dp
/** Wide widgets at least this tall get the large layout. */
private val activityWidgetLargeMinHeight = 220.dp
private const val activityWidgetSmallWeekCount: Int = 5
private const val activityWidgetWideWeekCount: Int = 20
/** The Scaffold's horizontal padding and the body's vertical padding. */
private val activityWidgetPadding = 12.dp
/** Height kept for one line of text and its spacer above or below the grid. */
private val activityWidgetTextLineHeight = 22.dp
private val activityWidgetLargeGridSpacing = 12.dp
/** The shortest grid the tall stat tiles may leave; below it the stats switch to single-line rows. */
private val activityWidgetLargeGridReadableHeight = 72.dp
/** Keeps the bitmap positive when even the single-line stat rows take the whole height at a huge font scale. */
private val activityWidgetLargeGridMinHeight = 24.dp
private const val activityWidgetLargeStatRowCount: Int = 4
private val activityWidgetLargeStatValueSize = 16.sp
private val activityWidgetCompactStatValueSize = 13.sp
private val activityWidgetStatLabelSize = 12.sp

class ActivityWidget : GlanceAppWidget() {
    /** Exact, so the grid bitmap is drawn at the real widget size instead of being scaled up from a bucket. */
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideStyledWidgetContent(context = context, observe = ::observeWidgetContent) { content ->
            ActivityWidgetBody(content = content, layoutSize = LocalSize.current)
        }
    }
}

class ActivityWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ActivityWidget()
}

internal fun activityWidgetSize(layoutSize: DpSize): ReviewWidgetSize {
    return when {
        layoutSize.width < activityWidgetMediumMinWidth -> ReviewWidgetSize.SMALL
        layoutSize.height < activityWidgetLargeMinHeight -> ReviewWidgetSize.MEDIUM
        else -> ReviewWidgetSize.LARGE
    }
}

@Composable
private fun ActivityWidgetBody(content: WidgetContent?, layoutSize: DpSize) {
    val context = LocalContext.current
    val size: ReviewWidgetSize = activityWidgetSize(layoutSize = layoutSize)
    val progress: WidgetProgressContent? = content?.progress
    val queue: ReviewWidgetContent? = content?.queue
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenProgressIntent(
                    context = context,
                    size = size,
                    kind = WidgetKind.ACTIVITY
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = activityWidgetPadding)) {
            when {
                progress == null -> ReviewWidgetOpenApp()
                size == ReviewWidgetSize.SMALL -> ActivityWidgetSmall(progress = progress, layoutSize = layoutSize)
                size == ReviewWidgetSize.MEDIUM -> ActivityWidgetMedium(progress = progress, layoutSize = layoutSize)
                queue == null -> ReviewWidgetOpenApp()
                else -> ActivityWidgetLarge(progress = progress, queue = queue, layoutSize = layoutSize)
            }
        }
    }
}

@Composable
private fun ColumnScope.ActivityWidgetSmall(progress: WidgetProgressContent, layoutSize: DpSize) {
    val context = LocalContext.current
    ActivityWidgetGrid(
        progress = progress,
        weekCount = activityWidgetSmallWeekCount,
        areaSize = gridAreaSize(layoutSize = layoutSize, reservedHeight = activityWidgetTextLineHeight),
        modifier = GlanceModifier.fillMaxWidth().defaultWeight()
    )
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
        text = context.getString(R.string.activity_widget_small_streak, progress.currentStreakDays),
        style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold),
        maxLines = 1
    )
}

@Composable
private fun ColumnScope.ActivityWidgetMedium(progress: WidgetProgressContent, layoutSize: DpSize) {
    val context = LocalContext.current
    val dates: List<LocalDate> = activityHeatmapDates(progress = progress, weekCount = activityWidgetWideWeekCount)
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (progress.currentStreakDays > 0) {
            Text(
                text = context.resources.getQuantityString(
                    R.plurals.activity_widget_streak_days,
                    progress.currentStreakDays,
                    progress.currentStreakDays
                ),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
        }
        Spacer(modifier = GlanceModifier.defaultWeight())
        val reviewCount: Int = sumReviewCounts(progress = progress, dates = dates.toSet())
        Text(
            text = context.resources.getQuantityString(R.plurals.activity_widget_reviews, reviewCount, reviewCount),
            style = activitySecondaryStyle(),
            maxLines = 1
        )
    }
    Spacer(modifier = GlanceModifier.height(4.dp))
    ActivityWidgetGrid(
        progress = progress,
        weekCount = activityWidgetWideWeekCount,
        areaSize = gridAreaSize(layoutSize = layoutSize, reservedHeight = activityWidgetTextLineHeight),
        modifier = GlanceModifier.fillMaxWidth().defaultWeight()
    )
}

@Composable
private fun ColumnScope.ActivityWidgetLarge(
    progress: WidgetProgressContent,
    queue: ReviewWidgetContent,
    layoutSize: DpSize
) {
    val context = LocalContext.current
    val shownDates: Set<LocalDate> = activityHeatmapDates(
        progress = progress,
        weekCount = activityWidgetWideWeekCount
    ).toSet()
    val layout: ActivityLargeLayout = activityLargeLayout(
        layoutSize = layoutSize,
        fontScale = context.resources.configuration.fontScale
    )
    ActivityWidgetGrid(
        progress = progress,
        weekCount = activityWidgetWideWeekCount,
        areaSize = layout.gridAreaSize,
        modifier = GlanceModifier.fillMaxWidth().height(layout.gridAreaSize.height)
    )
    Spacer(modifier = GlanceModifier.height(activityWidgetLargeGridSpacing))
    Column(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
        Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
            ActivityWidgetStat(
                label = context.getString(R.string.activity_widget_stat_current_streak),
                value = progress.currentStreakDays,
                tall = layout.tallStats,
                modifier = GlanceModifier.defaultWeight()
            )
            Spacer(modifier = GlanceModifier.width(12.dp))
            ActivityWidgetStat(
                label = context.getString(R.string.activity_widget_stat_best_streak),
                value = progress.longestStreakDays,
                tall = layout.tallStats,
                modifier = GlanceModifier.defaultWeight()
            )
        }
        Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
            ActivityWidgetStat(
                label = context.getString(R.string.activity_widget_stat_reviews),
                value = sumReviewCounts(progress = progress, dates = shownDates),
                tall = layout.tallStats,
                modifier = GlanceModifier.defaultWeight()
            )
            Spacer(modifier = GlanceModifier.width(12.dp))
            ActivityWidgetStat(
                label = context.getString(R.string.activity_widget_stat_active_days),
                value = countActiveDays(progress = progress, dates = shownDates),
                tall = layout.tallStats,
                modifier = GlanceModifier.defaultWeight()
            )
        }
        Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
            ActivityWidgetStat(
                label = context.getString(R.string.activity_widget_stat_today),
                value = sumReviewCounts(progress = progress, dates = setOf(progress.todayLocalDate)),
                tall = layout.tallStats,
                modifier = GlanceModifier.defaultWeight()
            )
            Spacer(modifier = GlanceModifier.width(12.dp))
            ActivityWidgetStat(
                label = context.getString(R.string.activity_widget_stat_due_now),
                value = queue.dueCount,
                tall = layout.tallStats,
                modifier = GlanceModifier.defaultWeight()
            )
        }
        Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
            ActivityWidgetStat(
                label = context.getString(R.string.activity_widget_stat_freezes),
                value = progress.availableFreezeCredits,
                tall = layout.tallStats,
                modifier = GlanceModifier.defaultWeight()
            )
            Spacer(modifier = GlanceModifier.width(12.dp))
            Spacer(modifier = GlanceModifier.defaultWeight())
        }
    }
}

/** A value over its label when [tall], otherwise the label and the value on one line. */
@Composable
private fun ActivityWidgetStat(label: String, value: Int, tall: Boolean, modifier: GlanceModifier) {
    val context = LocalContext.current
    val valueText: String = context.getString(R.string.activity_widget_stat_value, value)
    val labelStyle = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = activityWidgetStatLabelSize)
    if (tall) {
        Column(modifier = modifier) {
            Text(
                text = valueText,
                style = TextStyle(
                    color = GlanceTheme.colors.onSurface,
                    fontSize = activityWidgetLargeStatValueSize,
                    fontWeight = FontWeight.Bold
                ),
                maxLines = 1
            )
            Text(text = label, style = labelStyle, maxLines = 1)
        }
    } else {
        Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
            Text(text = label, style = labelStyle, maxLines = 1, modifier = GlanceModifier.defaultWeight())
            Text(
                text = valueText,
                style = TextStyle(
                    color = GlanceTheme.colors.onSurface,
                    fontSize = activityWidgetCompactStatValueSize,
                    fontWeight = FontWeight.Bold
                ),
                maxLines = 1
            )
        }
    }
}

/** [modifier] must give the image the [areaSize] the bitmap is drawn for, so it is shown at 1:1. */
@Composable
private fun ActivityWidgetGrid(
    progress: WidgetProgressContent,
    weekCount: Int,
    areaSize: DpSize,
    modifier: GlanceModifier
) {
    val context = LocalContext.current
    val dates: List<LocalDate> = activityHeatmapDates(progress = progress, weekCount = weekCount)
    Image(
        provider = ImageProvider(
            bitmap = drawActivityHeatmapBitmap(
                progress = progress,
                accentColor = widgetAccentColor(),
                dates = dates,
                weekCount = weekCount,
                areaSize = areaSize,
                density = context.resources.displayMetrics.density
            )
        ),
        contentDescription = context.resources.getQuantityString(
            R.plurals.activity_widget_grid_description,
            weekCount,
            weekCount
        ),
        contentScale = ContentScale.Fit,
        modifier = modifier
    )
}

private data class ActivityLargeLayout(val gridAreaSize: DpSize, val tallStats: Boolean)

/**
 * The 20-week grid's full width at the height its cells take when they fill that width, shortened
 * so the stat rows below fit at [fontScale]. The stats are tall tiles only when they still leave the
 * grid [activityWidgetLargeGridReadableHeight] (or its full-width height when that is less), so short
 * large widgets, common between the large threshold and ~270 dp, get single-line rows instead.
 */
private fun activityLargeLayout(layoutSize: DpSize, fontScale: Float): ActivityLargeLayout {
    val width: Dp = layoutSize.width - activityWidgetPadding * 2
    val filledWidthHeight: Dp = width / activityWidgetWideWeekCount * daysPerWeek
    val statsFreeHeight: Dp = layoutSize.height - activityWidgetPadding * 2 - activityWidgetLargeGridSpacing
    val tallStatRowHeight: Dp = widgetTextHeight(fontSize = activityWidgetLargeStatValueSize, lineCount = 1, fontScale = fontScale) +
        widgetTextHeight(fontSize = activityWidgetStatLabelSize, lineCount = 1, fontScale = fontScale)
    val tallGridHeight: Dp = minOf(filledWidthHeight, statsFreeHeight - tallStatRowHeight * activityWidgetLargeStatRowCount)
    if (tallGridHeight >= minOf(filledWidthHeight, activityWidgetLargeGridReadableHeight)) {
        return ActivityLargeLayout(gridAreaSize = DpSize(width = width, height = tallGridHeight), tallStats = true)
    }
    val compactStatRowHeight: Dp = widgetTextHeight(fontSize = activityWidgetCompactStatValueSize, lineCount = 1, fontScale = fontScale)
    val compactGridHeight: Dp = minOf(filledWidthHeight, statsFreeHeight - compactStatRowHeight * activityWidgetLargeStatRowCount)
    return ActivityLargeLayout(
        gridAreaSize = DpSize(width = width, height = compactGridHeight.coerceAtLeast(activityWidgetLargeGridMinHeight)),
        tallStats = false
    )
}

/** The layout size less the padding and [reservedHeight] for the text beside the grid. */
private fun gridAreaSize(layoutSize: DpSize, reservedHeight: Dp): DpSize {
    return DpSize(
        width = layoutSize.width - activityWidgetPadding * 2,
        height = layoutSize.height - activityWidgetPadding * 2 - reservedHeight
    )
}

@Composable
private fun activitySecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp)
}
