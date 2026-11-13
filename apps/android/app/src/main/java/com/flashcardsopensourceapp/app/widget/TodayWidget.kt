package com.flashcardsopensourceapp.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
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
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
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
import com.flashcardsopensourceapp.data.local.repository.progress.calculateStudySecondsOnDate
import com.flashcardsopensourceapp.data.local.repository.progress.reviewPaceMinimumHistoryDayCount
import com.flashcardsopensourceapp.data.local.repository.progress.roundStudyMinutes
import java.time.LocalDate
import java.time.temporal.ChronoUnit

private val todayWidgetSmallSize = DpSize(width = 100.dp, height = 100.dp)
private val todayWidgetMediumSize = DpSize(width = 220.dp, height = 100.dp)
internal val todayWidgetSizes: Set<DpSize> = setOf(todayWidgetSmallSize, todayWidgetMediumSize)
/** The ring bitmap is drawn at the small widget's minimum size and scaled down to fit the space left. */
private val todayWidgetRingBitmapSize = DpSize(width = 100.dp, height = 100.dp)
/** The medium widget's content height at its minimum size, so the ring keeps its place beside the text. */
private val todayWidgetMediumRingSize: Dp = 76.dp
/** The best-day line shows from this share of the best earlier day. */
private const val todayWidgetBestDayLineShare: Double = 0.8

class TodayWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(sizes = todayWidgetSizes)

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideStyledWidgetContent(context = context, observe = ::observeWidgetContent) { content ->
            TodayWidgetBody(content = content, size = todayWidgetSize(size = LocalSize.current))
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}

internal fun todayWidgetSize(size: DpSize): ReviewWidgetSize {
    return if (size == todayWidgetMediumSize) ReviewWidgetSize.MEDIUM else ReviewWidgetSize.SMALL
}

@Composable
private fun TodayWidgetBody(content: WidgetContent?, size: ReviewWidgetSize) {
    val context = LocalContext.current
    val queue: ReviewWidgetContent? = content?.queue
    val progress: WidgetProgressContent? = content?.progress
    Scaffold(
        backgroundColor = GlanceTheme.colors.surface,
        modifier = GlanceModifier.clickable(
            onClick = actionStartActivity(
                intent = ReviewWidgetTapContract.makeOpenReviewIntent(
                    context = context,
                    workspaceId = queue?.workspaceId,
                    size = size,
                    kind = WidgetKind.TODAY,
                    cardId = null,
                    revealAnswer = false
                )
            )
        )
    ) {
        Column(modifier = GlanceModifier.fillMaxSize().padding(vertical = 12.dp)) {
            if (queue == null || progress == null) {
                TodayWidgetOpenApp()
            } else {
                when (size) {
                    ReviewWidgetSize.SMALL -> TodayWidgetSmall(progress = progress)
                    ReviewWidgetSize.MEDIUM, ReviewWidgetSize.LARGE -> TodayWidgetMedium(queue = queue, progress = progress)
                }
            }
        }
    }
}

@Composable
private fun ColumnScope.TodayWidgetOpenApp() {
    val context = LocalContext.current
    Text(
        text = context.getString(R.string.app_name),
        style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 18.sp, fontWeight = FontWeight.Bold),
        maxLines = 2
    )
    Spacer(modifier = GlanceModifier.height(4.dp))
    Text(
        text = context.getString(R.string.review_widget_open_app_message),
        style = secondaryStyle(),
        maxLines = 3
    )
}

/** The pace ring, today's reviews and the streak. */
@Composable
private fun ColumnScope.TodayWidgetSmall(progress: WidgetProgressContent) {
    val context = LocalContext.current
    WidgetPaceRing(
        pace = progress.pace,
        bitmapSize = todayWidgetRingBitmapSize,
        numberFontSize = 16.sp,
        modifier = GlanceModifier.fillMaxWidth().defaultWeight()
    )
    Spacer(modifier = GlanceModifier.height(2.dp))
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = todayWidgetTodayCountText(context = context, progress = progress),
            style = secondaryStyle(),
            maxLines = 1,
            modifier = GlanceModifier.defaultWeight()
        )
        TodayWidgetStreakFlame(progress = progress, iconSize = 14.dp)
        Text(
            text = context.getString(R.string.today_widget_count, progress.currentStreakDays),
            style = secondaryStyle(),
            maxLines = 1
        )
    }
}

/** The pace ring; today's reviews, the cards due, and the best day or today's study time; the streak. */
@Composable
private fun ColumnScope.TodayWidgetMedium(queue: ReviewWidgetContent, progress: WidgetProgressContent) {
    val context = LocalContext.current
    val thirdLine: String? = todayWidgetBestDayText(context = context, progress = progress)
        ?: todayWidgetStudyTimeText(context = context, progress = progress)
    Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
        WidgetPaceRing(
            pace = progress.pace,
            bitmapSize = todayWidgetRingBitmapSize,
            numberFontSize = 16.sp,
            modifier = GlanceModifier.size(todayWidgetMediumRingSize)
        )
        Spacer(modifier = GlanceModifier.width(12.dp))
        Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = todayWidgetTodayCountText(context = context, progress = progress),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
            Text(
                text = widgetScheduledDueText(context = context, scheduledDueCount = queue.scheduledDueCount),
                style = secondaryStyle(),
                maxLines = 1
            )
            if (thirdLine != null) {
                Text(text = thirdLine, style = secondaryStyle(), maxLines = 1)
            }
        }
        Spacer(modifier = GlanceModifier.width(8.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            TodayWidgetStreakFlame(progress = progress, iconSize = 24.dp)
            Text(
                text = context.getString(R.string.today_widget_count, progress.currentStreakDays),
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 16.sp, fontWeight = FontWeight.Bold),
                maxLines = 1
            )
        }
    }
}

/** The flame is in the accent color once the user has reviewed today, as on the Review top bar. */
@Composable
private fun TodayWidgetStreakFlame(progress: WidgetProgressContent, iconSize: Dp) {
    val context = LocalContext.current
    val tint: ColorProvider = if (progress.todayReviewCount > 0) GlanceTheme.colors.primary else GlanceTheme.colors.onSurfaceVariant
    Image(
        provider = ImageProvider(resId = R.drawable.widget_streak_flame),
        contentDescription = context.resources.getQuantityString(
            R.plurals.review_widget_streak_days,
            progress.currentStreakDays,
            progress.currentStreakDays
        ),
        colorFilter = ColorFilter.tint(colorProvider = tint),
        modifier = GlanceModifier.size(iconSize)
    )
}

private fun todayWidgetTodayCountText(context: Context, progress: WidgetProgressContent): String {
    return context.resources.getQuantityString(
        R.plurals.today_widget_today_count,
        progress.todayReviewCount,
        progress.todayReviewCount
    )
}

/**
 * "Best day 61" from 80% of the best earlier day, "New best day" once today passes it; nothing in the
 * first 14 days of history, when every growing day would be a record.
 */
private fun todayWidgetBestDayText(context: Context, progress: WidgetProgressContent): String? {
    val bestDay = progress.insights?.bestDayBeforeToday ?: return null
    if (!hasReviewHistoryDays(progress = progress, minimumDayCount = reviewPaceMinimumHistoryDayCount)) {
        return null
    }
    return when {
        progress.todayReviewCount > bestDay.reviewCount -> context.getString(R.string.today_widget_new_best_day)
        progress.todayReviewCount >= bestDay.reviewCount * todayWidgetBestDayLineShare -> context.getString(
            R.string.today_widget_best_day,
            bestDay.reviewCount
        )
        else -> null
    }
}

/** Today's study time; hidden at 0 and without the server's timing sample. */
private fun todayWidgetStudyTimeText(context: Context, progress: WidgetProgressContent): String? {
    val seconds: Int = calculateStudySecondsOnDate(insights = progress.insights, date = progress.todayLocalDate) ?: return null
    val minutes: Int = roundStudyMinutes(seconds = seconds.toDouble())
    if (minutes == 0) {
        return null
    }
    return widgetMinutesText(context = context, minutes = minutes)
}

/** The first reviewed day in the history stands for the first review, as in the pace. */
private fun hasReviewHistoryDays(progress: WidgetProgressContent, minimumDayCount: Int): Boolean {
    val firstReviewDate: LocalDate = progress.days.firstOrNull { day -> day.reviewCount > 0 }?.localDate ?: return false
    return ChronoUnit.DAYS.between(firstReviewDate, progress.todayLocalDate) + 1L >= minimumDayCount
}

@Composable
private fun secondaryStyle(): TextStyle {
    return TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 13.sp)
}
