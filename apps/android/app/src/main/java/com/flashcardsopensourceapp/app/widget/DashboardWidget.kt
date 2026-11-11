package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
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
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import java.time.LocalDate

/** The Scaffold's horizontal padding and the body's vertical padding. */
private val dashboardWidgetPadding = 12.dp
/** `dashboard_widget_info.xml`'s minimum resize size; smaller launcher-reported sizes use it. */
private val dashboardWidgetMinimumSize = DpSize(width = 250.dp, height = 250.dp)
private val dashboardWidgetRingSize = 56.dp
private const val DASHBOARD_WIDGET_RING_STROKE_FRACTION: Float = 0.1f
private val dashboardWidgetSectionSpacing = 8.dp
private val dashboardWidgetFooterSpacing = 4.dp
private val dashboardWidgetDueCountTextSize = 24.sp
private val dashboardWidgetQuestionTextSize = 16.sp
private const val dashboardWidgetQuestionMaxLines: Int = 3
private val dashboardWidgetSecondaryTextSize = 13.sp
private const val dashboardWidgetHeatmapMinWeekCount: Int = 5
private const val dashboardWidgetHeatmapMaxWeekCount: Int = 20
/** Keeps the bitmap positive when the text around the heatmap takes the whole height at a large font scale. */
private val dashboardWidgetHeatmapMinHeight = 35.dp

class DashboardWidget : GlanceAppWidget() {
    /**
     * Exact, so the heatmap is drawn at the size it is shown instead of being scaled up from a bucket.
     * The Dashboard has only a large layout; `dashboard_widget_info.xml` keeps it from being resized smaller.
     */
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideStyledWidgetContent(context = context, observe = ::observeWidgetContent) { content ->
            DashboardWidgetBody(content = content, layoutSize = LocalSize.current)
        }
    }
}

class DashboardWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DashboardWidget()
}

@Composable
private fun DashboardWidgetBody(content: WidgetContent?, layoutSize: DpSize) {
    val context = LocalContext.current
    val queue: ReviewWidgetContent? = content?.queue
    val progress: WidgetProgressContent? = content?.progress
    // The card the widget shows, which a tap opens Review on, as on the large Review widget.
    val shownCard: ReviewWidgetCard? = if (queue == null || progress == null) {
        null
    } else {
        queue.nextCard?.takeIf { queue.dueCount > 0 }
    }
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        horizontalPadding = dashboardWidgetPadding,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenReviewIntent(
                    context = context,
                    workspaceId = queue?.workspaceId,
                    size = ReviewWidgetSize.LARGE,
                    kind = WidgetKind.DASHBOARD,
                    cardId = shownCard?.cardId
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = dashboardWidgetPadding)) {
            if (queue == null || progress == null) {
                ReviewWidgetOpenApp()
            } else {
                val todayReviewCount: Int = sumReviewCounts(progress = progress, dates = setOf(progress.todayLocalDate))
                DashboardWidgetTopRow(queue = queue, progress = progress, todayReviewCount = todayReviewCount)
                Spacer(modifier = GlanceModifier.height(dashboardWidgetSectionSpacing))
                // Centered, so the room kept for a 3-line question splits above and below a shorter one.
                Column(
                    modifier = GlanceModifier.fillMaxWidth().defaultWeight(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    DashboardWidgetNext(queue = queue, card = shownCard)
                }
                Spacer(modifier = GlanceModifier.height(dashboardWidgetSectionSpacing))
                DashboardWidgetActivity(progress = progress, layoutSize = layoutSize)
            }
        }
    }
}

/** Today's ring with today's reviews inside, the cards due now, and the streak. */
@Composable
private fun DashboardWidgetTopRow(queue: ReviewWidgetContent, progress: WidgetProgressContent, todayReviewCount: Int) {
    val context = LocalContext.current
    val totalCount: Int = todayReviewCount + queue.dueCount
    val fraction: Float = if (totalCount == 0) 0f else todayReviewCount.toFloat() / totalCount
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = GlanceModifier.size(dashboardWidgetRingSize), contentAlignment = Alignment.Center) {
            Image(
                provider = ImageProvider(
                    bitmap = makeDashboardWidgetRingBitmap(
                        context = context,
                        fraction = fraction,
                        accentArgb = widgetAccentColor().toArgb()
                    )
                ),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = GlanceModifier.fillMaxSize()
            )
            if (totalCount > 0) {
                Text(
                    text = context.getString(R.string.today_widget_count, todayReviewCount),
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp, fontWeight = FontWeight.Bold),
                    maxLines = 1
                )
            }
        }
        Spacer(modifier = GlanceModifier.width(12.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
            Text(
                text = context.getString(R.string.review_widget_due_count, queue.dueCount),
                style = TextStyle(color = GlanceTheme.colors.primary, fontSize = dashboardWidgetDueCountTextSize, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
            Text(text = context.getString(R.string.review_widget_due_label), style = dashboardSecondaryStyle(), maxLines = 1)
        }
        Spacer(modifier = GlanceModifier.width(8.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            DashboardWidgetStreakFlame(
                streakDays = progress.currentStreakDays,
                reviewedToday = todayReviewCount > 0,
                iconSize = 22.dp
            )
            Text(
                text = context.getString(R.string.today_widget_count, progress.currentStreakDays),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
        }
    }
}

/** The next question, or the Review widget's all-done state with the next due time; never the answer. */
@Composable
private fun ColumnScope.DashboardWidgetNext(queue: ReviewWidgetContent, card: ReviewWidgetCard?) {
    val context = LocalContext.current
    if (queue.dueCount == 0) {
        Text(
            text = context.getString(R.string.review_widget_all_done),
            style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold),
            maxLines = 1
        )
        val nextDueAtMillis: Long? = queue.nextDueAtMillis
        if (nextDueAtMillis != null) {
            Spacer(modifier = GlanceModifier.height(4.dp))
            Text(
                text = context.getString(
                    R.string.review_widget_next_due,
                    formatReviewWidgetDueTime(context = context, dueAtMillis = nextDueAtMillis)
                ),
                style = dashboardSecondaryStyle(),
                maxLines = 2
            )
        }
        return
    }
    if (card != null) {
        Text(
            text = card.frontPlainText.ifBlank { context.getString(R.string.review_widget_question_without_text) },
            style = TextStyle(
                color = GlanceTheme.colors.onSurface,
                fontSize = dashboardWidgetQuestionTextSize,
                fontWeight = FontWeight.Medium
            ),
            maxLines = dashboardWidgetQuestionMaxLines
        )
    }
}

/** The heatmap fills the height the text above and below leaves it, with as many weeks as fit the width. */
@Composable
private fun DashboardWidgetActivity(progress: WidgetProgressContent, layoutSize: DpSize) {
    val context = LocalContext.current
    val heatmapHeight: Dp = dashboardWidgetHeatmapHeight(
        layoutSize = layoutSize,
        fontScale = context.resources.configuration.fontScale
    )
    val contentWidth: Dp = maxOf(layoutSize.width, dashboardWidgetMinimumSize.width) - dashboardWidgetPadding * 2
    val weekCount: Int = (contentWidth / (heatmapHeight / daysPerWeek)).toInt()
        .coerceIn(minimumValue = dashboardWidgetHeatmapMinWeekCount, maximumValue = dashboardWidgetHeatmapMaxWeekCount)
    val cellPitch: Dp = minOf(contentWidth / weekCount, heatmapHeight / daysPerWeek)
    val gridSize = DpSize(width = cellPitch * weekCount, height = cellPitch * daysPerWeek)
    val dates: List<LocalDate> = activityHeatmapDates(progress = progress, weekCount = weekCount)
    val shownDates: Set<LocalDate> = dates.toSet()
    val reviewCount: Int = sumReviewCounts(progress = progress, dates = shownDates)
    val activeDayCount: Int = countActiveDays(progress = progress, dates = shownDates)
    Image(
        provider = ImageProvider(
            bitmap = drawActivityHeatmapBitmap(
                progress = progress,
                accentColor = widgetAccentColor(),
                dates = dates,
                weekCount = weekCount,
                areaSize = gridSize,
                density = context.resources.displayMetrics.density
            )
        ),
        contentDescription = context.resources.getQuantityString(
            R.plurals.activity_widget_grid_description,
            weekCount,
            weekCount
        ),
        contentScale = ContentScale.Fit,
        modifier = GlanceModifier.size(width = gridSize.width, height = gridSize.height)
    )
    Spacer(modifier = GlanceModifier.height(dashboardWidgetFooterSpacing))
    Row(modifier = GlanceModifier.fillMaxWidth()) {
        Text(
            text = context.resources.getQuantityString(R.plurals.activity_widget_reviews, reviewCount, reviewCount),
            style = dashboardSecondaryStyle(),
            maxLines = 1
        )
        Spacer(modifier = GlanceModifier.defaultWeight())
        Text(
            text = context.resources.getQuantityString(R.plurals.year_widget_active_days, activeDayCount, activeDayCount),
            style = dashboardSecondaryStyle(),
            maxLines = 1
        )
    }
}

/**
 * The height the top row, a question of [dashboardWidgetQuestionMaxLines] lines, the footer, and their
 * spacing leave at [fontScale]; it never depends on the width, so the bitmap stays positive whatever
 * width a launcher reports.
 */
private fun dashboardWidgetHeatmapHeight(layoutSize: DpSize, fontScale: Float): Dp {
    val contentHeight: Dp = maxOf(layoutSize.height, dashboardWidgetMinimumSize.height) - dashboardWidgetPadding * 2
    val topRowHeight: Dp = maxOf(
        dashboardWidgetRingSize,
        widgetTextHeight(fontSize = dashboardWidgetDueCountTextSize, lineCount = 1, fontScale = fontScale) +
            widgetTextHeight(fontSize = dashboardWidgetSecondaryTextSize, lineCount = 1, fontScale = fontScale)
    )
    val questionHeight: Dp = widgetTextHeight(
        fontSize = dashboardWidgetQuestionTextSize,
        lineCount = dashboardWidgetQuestionMaxLines,
        fontScale = fontScale
    )
    val footerHeight: Dp = dashboardWidgetFooterSpacing +
        widgetTextHeight(fontSize = dashboardWidgetSecondaryTextSize, lineCount = 1, fontScale = fontScale)
    return (contentHeight - topRowHeight - questionHeight - footerHeight - dashboardWidgetSectionSpacing * 2)
        .coerceAtLeast(dashboardWidgetHeatmapMinHeight)
}

/** The flame is in the accent color once the user has reviewed today, as on the Today widget. */
@Composable
private fun DashboardWidgetStreakFlame(streakDays: Int, reviewedToday: Boolean, iconSize: Dp) {
    val context = LocalContext.current
    val tint: ColorProvider = if (reviewedToday) GlanceTheme.colors.primary else GlanceTheme.colors.onSurfaceVariant
    Image(
        provider = ImageProvider(resId = R.drawable.widget_streak_flame),
        contentDescription = context.resources.getQuantityString(R.plurals.review_widget_streak_days, streakDays, streakDays),
        colorFilter = ColorFilter.tint(colorProvider = tint),
        modifier = GlanceModifier.size(iconSize)
    )
}

/** Drawn at the ring's shown size. */
private fun makeDashboardWidgetRingBitmap(context: Context, fraction: Float, accentArgb: Int): Bitmap {
    return drawWidgetBitmap(
        size = DpSize(width = dashboardWidgetRingSize, height = dashboardWidgetRingSize),
        density = context.resources.displayMetrics.density
    ) { canvas ->
        drawWidgetProgressRing(
            canvas = canvas,
            fraction = fraction,
            strokeWidthPx = canvas.width * DASHBOARD_WIDGET_RING_STROKE_FRACTION,
            trackColor = FlashcardsDarkColorScheme.surfaceVariant.toArgb(),
            progressColor = accentArgb
        )
    }
}

@Composable
private fun dashboardSecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = dashboardWidgetSecondaryTextSize)
}
