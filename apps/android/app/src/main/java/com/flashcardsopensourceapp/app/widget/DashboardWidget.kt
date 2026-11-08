package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import androidx.glance.appwidget.provideContent
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
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import java.time.LocalDate
import kotlinx.coroutines.flow.first

private val dashboardWidgetColors = ColorProviders(scheme = FlashcardsDarkColorScheme)
/** The Scaffold's horizontal padding and the body's vertical padding. */
private val dashboardWidgetPadding = 12.dp
/** `dashboard_widget_info.xml`'s minimum resize height; smaller launcher-reported heights use it. */
private val dashboardWidgetMinimumHeight = 250.dp
private val dashboardWidgetRingSize = 56.dp
private const val DASHBOARD_WIDGET_RING_STROKE_FRACTION: Float = 0.1f
private const val dashboardWidgetHeatmapWeekCount: Int = 5
private const val dashboardWidgetHeatmapDayCount: Int = 7
/** The heatmap's share of the content height, kept between the two heights below. */
private const val DASHBOARD_WIDGET_HEATMAP_HEIGHT_FRACTION: Float = 0.32f
private val dashboardWidgetHeatmapMinHeight = 70.dp
private val dashboardWidgetHeatmapMaxHeight = 126.dp

class DashboardWidget : GlanceAppWidget() {
    /**
     * Exact, so the heatmap is drawn at the size it is shown instead of being scaled up from a bucket.
     * The Dashboard has only a large layout; `dashboard_widget_info.xml` keeps it from being resized smaller.
     */
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val contentFlow = observeWithCurrentAppGraph(
            application = context.applicationContext as FlashcardsApplication,
            observe = ::observeWidgetContent
        )
        val initialContent = contentFlow.first()
        provideContent {
            val content by contentFlow.collectAsState(initial = initialContent)
            GlanceTheme(colors = dashboardWidgetColors) {
                DashboardWidgetBody(content = content, layoutSize = LocalSize.current)
            }
        }
    }
}

class DashboardWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DashboardWidget()
}

@Composable
private fun DashboardWidgetBody(content: WidgetContent, layoutSize: DpSize) {
    val context = LocalContext.current
    val queue: ReviewWidgetContent? = content.queue
    val progress: WidgetProgressContent? = content.progress
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
                Spacer(modifier = GlanceModifier.height(8.dp))
                Column(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
                    DashboardWidgetNext(queue = queue, card = shownCard)
                }
                Spacer(modifier = GlanceModifier.height(8.dp))
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
                provider = ImageProvider(bitmap = makeDashboardWidgetRingBitmap(context = context, fraction = fraction)),
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
                style = TextStyle(color = GlanceTheme.colors.primary, fontSize = 24.sp, fontWeight = FontWeight.Bold),
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
            style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Medium),
            maxLines = 3
        )
    }
}

/** The 5-week mini heatmap at the bottom left, with its reviews and active days beside it. */
@Composable
private fun DashboardWidgetActivity(progress: WidgetProgressContent, layoutSize: DpSize) {
    val context = LocalContext.current
    val dates: List<LocalDate> = activityHeatmapDates(progress = progress, weekCount = dashboardWidgetHeatmapWeekCount)
    val shownDates: Set<LocalDate> = dates.toSet()
    val reviewCount: Int = sumReviewCounts(progress = progress, dates = shownDates)
    val activeDayCount: Int = countActiveDays(progress = progress, dates = shownDates)
    val gridSize: DpSize = dashboardWidgetHeatmapSize(layoutSize = layoutSize)
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Image(
            provider = ImageProvider(
                bitmap = drawActivityHeatmapBitmap(
                    progress = progress,
                    dates = dates,
                    weekCount = dashboardWidgetHeatmapWeekCount,
                    areaSize = gridSize,
                    density = context.resources.displayMetrics.density
                )
            ),
            contentDescription = context.resources.getQuantityString(
                R.plurals.activity_widget_grid_description,
                dashboardWidgetHeatmapWeekCount,
                dashboardWidgetHeatmapWeekCount
            ),
            contentScale = ContentScale.Fit,
            modifier = GlanceModifier.size(width = gridSize.width, height = gridSize.height)
        )
        Spacer(modifier = GlanceModifier.width(12.dp))
        Column(modifier = GlanceModifier.defaultWeight()) {
            Text(
                text = context.resources.getQuantityString(R.plurals.activity_widget_reviews, reviewCount, reviewCount),
                style = dashboardSecondaryStyle(),
                maxLines = 1
            )
            Text(
                text = context.resources.getQuantityString(R.plurals.year_widget_active_days, activeDayCount, activeDayCount),
                style = dashboardSecondaryStyle(),
                maxLines = 1
            )
        }
    }
}

/**
 * A grid of square cells whose height grows with the widget; it never depends on the width, so the
 * bitmap stays positive whatever size a launcher reports.
 */
private fun dashboardWidgetHeatmapSize(layoutSize: DpSize): DpSize {
    val contentHeight: Dp = maxOf(layoutSize.height, dashboardWidgetMinimumHeight) - dashboardWidgetPadding * 2
    val height: Dp = (contentHeight * DASHBOARD_WIDGET_HEATMAP_HEIGHT_FRACTION)
        .coerceIn(minimumValue = dashboardWidgetHeatmapMinHeight, maximumValue = dashboardWidgetHeatmapMaxHeight)
    return DpSize(width = height * dashboardWidgetHeatmapWeekCount / dashboardWidgetHeatmapDayCount, height = height)
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
private fun makeDashboardWidgetRingBitmap(context: Context, fraction: Float): Bitmap {
    return drawWidgetBitmap(
        size = DpSize(width = dashboardWidgetRingSize, height = dashboardWidgetRingSize),
        density = context.resources.displayMetrics.density
    ) { canvas ->
        drawWidgetProgressRing(
            canvas = canvas,
            fraction = fraction,
            strokeWidthPx = canvas.width * DASHBOARD_WIDGET_RING_STROKE_FRACTION,
            trackColor = FlashcardsDarkColorScheme.surfaceVariant.toArgb(),
            progressColor = FlashcardsDarkColorScheme.primary.toArgb()
        )
    }
}

@Composable
private fun dashboardSecondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}
