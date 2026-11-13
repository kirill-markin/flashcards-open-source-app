package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Typeface
import android.util.DisplayMetrics
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.layout.Alignment
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.data.local.repository.progress.calculateLast7DaysStudySeconds
import com.flashcardsopensourceapp.data.local.repository.progress.reviewPaceWindowDayCount
import com.flashcardsopensourceapp.data.local.repository.progress.roundStudyMinutes
import com.flashcardsopensourceapp.feature.progress.R as ProgressR
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.TextStyle as DateTextStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

private val reviewsChartTrendFontSize: TextUnit = 11.sp
private val reviewsChartMediumSpacing: Dp = 4.dp
private val reviewsChartLargeSpacing: Dp = 6.dp

// Copy of the rating colours in feature/progress ProgressReviewsSection.kt.
private val reviewsChartAgainColor = Color(0xFFD7263D)
private val reviewsChartHardColor = Color(0xFFE69F00)
private val reviewsChartGoodColor = Color(0xFF2BB673)
private val reviewsChartEasyColor = Color(0xFF3F7CC8)

class ReviewsChartWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = chartWidgetSizeMode

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideStyledWidgetContent(context = context, observe = ::observeWidgetProgressContent) { progress ->
            ReviewsChartWidgetBody(progress = progress, widgetSize = LocalSize.current)
        }
    }
}

class ReviewsChartWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ReviewsChartWidget()
}

private data class ReviewsChartBarSegment(val count: Int, val argb: Int)

/** [segments] stack bottom to top. */
private data class ReviewsChartBar(val localDate: LocalDate, val segments: List<ReviewsChartBarSegment>)

/** Each bar's date label: the weekday letter alone, or with the day of the month on a second line. */
private enum class ReviewsChartDateLabels(val lineCount: Int) {
    WEEKDAY(lineCount = 1),
    WEEKDAY_AND_DAY(lineCount = 2)
}

/**
 * The last 7 days, as the pace counts them, against the usual daily average. [percentChange] and
 * [usualReviewsPerDay] are null without a pace baseline.
 */
private data class ReviewsChartSummary(
    val days: List<WidgetProgressDay>,
    val averagePerDay: Double,
    val percentChange: Int?,
    val usualReviewsPerDay: Double?
)

private fun makeReviewsChartSummary(progress: WidgetProgressContent): ReviewsChartSummary {
    val days: List<WidgetProgressDay> = progress.days.takeLast(n = reviewPaceWindowDayCount)
    require(days.isNotEmpty()) {
        "Progress history ending ${progress.todayLocalDate} has no days for the Reviews chart widget."
    }
    return ReviewsChartSummary(
        days = days,
        averagePerDay = progress.pace.last7DaysAveragePerDay,
        percentChange = progress.pace.baseline?.percentChange,
        usualReviewsPerDay = progress.pace.baseline?.usualReviewsPerDay
    )
}

private fun makeReviewsChartBars(days: List<WidgetProgressDay>): List<ReviewsChartBar> {
    return days.map { day ->
        ReviewsChartBar(
            localDate = day.localDate,
            segments = listOf(
                ReviewsChartBarSegment(count = day.againCount, argb = reviewsChartAgainColor.toArgb()),
                ReviewsChartBarSegment(count = day.hardCount, argb = reviewsChartHardColor.toArgb()),
                ReviewsChartBarSegment(count = day.goodCount, argb = reviewsChartGoodColor.toArgb()),
                ReviewsChartBarSegment(count = day.easyCount, argb = reviewsChartEasyColor.toArgb())
            )
        )
    }
}

@Composable
private fun ReviewsChartWidgetBody(progress: WidgetProgressContent?, widgetSize: DpSize) {
    val size: ReviewWidgetSize = chartWidgetSize(size = widgetSize)
    ChartWidgetScaffold(size = size, kind = WidgetKind.REVIEWS_CHART) {
        when {
            progress == null -> ChartWidgetOpenApp()
            size == ReviewWidgetSize.LARGE -> ReviewsChartLarge(progress = progress, widgetSize = widgetSize)
            else -> ReviewsChartMedium(progress = progress, widgetSize = widgetSize)
        }
    }
}

/** The daily average and the pace, over 7 rating-coloured bars with the usual as a dashed line. */
@Composable
private fun ColumnScope.ReviewsChartMedium(progress: WidgetProgressContent, widgetSize: DpSize) {
    val fontScale: Float = LocalContext.current.resources.configuration.fontScale
    val summary = makeReviewsChartSummary(progress = progress)
    ReviewsChartHeader(summary = summary)
    Spacer(modifier = GlanceModifier.height(reviewsChartMediumSpacing))
    ReviewsChartImage(
        bars = makeReviewsChartBars(days = summary.days),
        usualReviewsPerDay = summary.usualReviewsPerDay,
        dateLabels = ReviewsChartDateLabels.WEEKDAY,
        bitmapSize = chartWidgetBitmapSize(
            widgetSize = widgetSize,
            reservedHeight = reviewsChartHeaderHeight(fontScale = fontScale) + reviewsChartMediumSpacing
        )
    )
}

/** Medium's chart with dates under the bars, the rating counts of the 7 days, and their study time. */
@Composable
private fun ColumnScope.ReviewsChartLarge(progress: WidgetProgressContent, widgetSize: DpSize) {
    val context = LocalContext.current
    val fontScale: Float = context.resources.configuration.fontScale
    val summary = makeReviewsChartSummary(progress = progress)
    val studyMinutes: Int = roundStudyMinutes(
        seconds = (calculateLast7DaysStudySeconds(insights = progress.insights) ?: 0).toDouble()
    )
    val footerHeight: Dp = if (studyMinutes > 0) {
        reviewsChartLargeSpacing + widgetTextHeight(fontSize = chartWidgetLegendFontSize, lineCount = 1, fontScale = fontScale)
    } else {
        0.dp
    }
    ReviewsChartHeader(summary = summary)
    Spacer(modifier = GlanceModifier.height(reviewsChartLargeSpacing))
    ReviewsChartImage(
        bars = makeReviewsChartBars(days = summary.days),
        usualReviewsPerDay = summary.usualReviewsPerDay,
        dateLabels = ReviewsChartDateLabels.WEEKDAY_AND_DAY,
        bitmapSize = chartWidgetBitmapSize(
            widgetSize = widgetSize,
            reservedHeight = reviewsChartHeaderHeight(fontScale = fontScale) +
                reviewsChartLargeSpacing * 2 +
                widgetTextHeight(fontSize = chartWidgetLegendFontSize, lineCount = 1, fontScale = fontScale) +
                footerHeight
        )
    )
    Spacer(modifier = GlanceModifier.height(reviewsChartLargeSpacing))
    val countFormat: NumberFormat = NumberFormat.getIntegerInstance(context.resources.configuration.locales.get(0))
    Row(modifier = GlanceModifier.fillMaxWidth()) {
        listOf(
            Triple(reviewsChartAgainColor, ProgressR.string.progress_reviews_rating_again, summary.days.sumOf { day -> day.againCount }),
            Triple(reviewsChartHardColor, ProgressR.string.progress_reviews_rating_hard, summary.days.sumOf { day -> day.hardCount }),
            Triple(reviewsChartGoodColor, ProgressR.string.progress_reviews_rating_good, summary.days.sumOf { day -> day.goodCount }),
            Triple(reviewsChartEasyColor, ProgressR.string.progress_reviews_rating_easy, summary.days.sumOf { day -> day.easyCount })
        ).forEach { (color, labelResId, count) ->
            ChartWidgetLegendItem(
                color = color,
                label = context.getString(labelResId),
                count = countFormat.format(count.toLong()),
                modifier = GlanceModifier.defaultWeight().padding(end = 4.dp)
            )
        }
    }
    if (studyMinutes > 0) {
        Spacer(modifier = GlanceModifier.height(reviewsChartLargeSpacing))
        Text(
            text = widgetMinutesText(context = context, minutes = studyMinutes),
            style = chartWidgetLegendStyle(),
            maxLines = 1
        )
    }
}

/** "Daily avg 13.1", then "↑ 64%" against the usual when there is a baseline; 0% has no arrow. */
@Composable
private fun ReviewsChartHeader(summary: ReviewsChartSummary) {
    val context = LocalContext.current
    val locale: Locale = context.resources.configuration.locales.get(0)
    val averageFormat: NumberFormat = NumberFormat.getNumberInstance(locale).apply {
        maximumFractionDigits = 1
    }
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = context.getString(
                R.string.reviews_chart_widget_daily_average_value,
                averageFormat.format(summary.averagePerDay)
            ),
            style = chartWidgetHeaderStyle(),
            maxLines = 1
        )
        val percentChange: Int? = summary.percentChange
        if (percentChange != null) {
            Spacer(modifier = GlanceModifier.width(6.dp))
            Text(
                text = formatReviewsChartPercentChange(percentChange = percentChange, locale = locale),
                style = TextStyle(color = GlanceTheme.colors.primary, fontSize = reviewsChartTrendFontSize),
                maxLines = 1
            )
        }
    }
}

/** Shown in the accent both ways, never red: a pace is effort, not a grade. */
private fun formatReviewsChartPercentChange(percentChange: Int, locale: Locale): String {
    val percentLabel: String = NumberFormat.getPercentInstance(locale).apply {
        maximumFractionDigits = 0
    }.format(abs(percentChange) / 100.0)
    val arrow: String = when {
        percentChange > 0 -> "↑ "
        percentChange < 0 -> "↓ "
        else -> ""
    }
    return arrow + percentLabel
}

/** [ReviewsChartHeader]'s height: one line of the daily average. */
private fun reviewsChartHeaderHeight(fontScale: Float): Dp {
    return widgetTextHeight(fontSize = chartWidgetHeaderFontSize, lineCount = 1, fontScale = fontScale)
}

@Composable
private fun ColumnScope.ReviewsChartImage(
    bars: List<ReviewsChartBar>,
    usualReviewsPerDay: Double?,
    dateLabels: ReviewsChartDateLabels,
    bitmapSize: DpSize
) {
    val context = LocalContext.current
    val displayMetrics: DisplayMetrics = context.resources.displayMetrics
    val locale: Locale = context.resources.configuration.locales.get(0)
    ChartWidgetImage(
        bitmap = drawWidgetBitmap(size = bitmapSize, density = displayMetrics.density) { canvas ->
            drawReviewsChart(
                canvas = canvas,
                bars = bars,
                usualReviewsPerDay = usualReviewsPerDay?.toFloat(),
                dateLabels = dateLabels,
                displayMetrics = displayMetrics,
                locale = locale
            )
        }
    )
}

/** Bars scaled to the busiest day or the usual, a dashed usual line, and a date label under every bar. */
private fun drawReviewsChart(
    canvas: Canvas,
    bars: List<ReviewsChartBar>,
    usualReviewsPerDay: Float?,
    dateLabels: ReviewsChartDateLabels,
    displayMetrics: DisplayMetrics,
    locale: Locale
) {
    val density: Float = displayMetrics.density
    val width: Float = canvas.width.toFloat()
    val height: Float = canvas.height.toFloat()
    val slotWidth: Float = width / bars.size
    val weekdayLabels: List<String> = bars.map { bar -> bar.localDate.dayOfWeek.getDisplayName(DateTextStyle.NARROW, locale) }
    val dayLabels: List<String> = bars.map { bar ->
        NumberFormat.getIntegerInstance(locale).format(bar.localDate.dayOfMonth.toLong())
    }
    val labelPaint: Paint = makeChartWidgetLabelPaint(
        displayMetrics = displayMetrics,
        argb = chartWidgetLabelArgb,
        typeface = Typeface.DEFAULT,
        labels = weekdayLabels + dayLabels,
        maxLabelWidth = slotWidth - 2f * density,
        maxLabelHeight = height * chartWidgetMaxLabelHeightFraction / dateLabels.lineCount
    )
    val chartTop: Float = density
    val chartBottom: Float = height - labelPaint.fontSpacing * dateLabels.lineCount - 2f * density
    val chartHeight: Float = chartBottom - chartTop
    val maxValue: Float = max(
        bars.maxOf { bar -> bar.segments.sumOf { segment -> segment.count } }.toFloat(),
        usualReviewsPerDay ?: 0f
    ).coerceAtLeast(minimumValue = 1f)
    val barWidth: Float = slotWidth * 0.64f
    val barPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    bars.forEachIndexed { index, bar ->
        val left: Float = index * slotWidth + (slotWidth - barWidth) / 2f
        var segmentBottom: Float = chartBottom
        bar.segments.filter { segment -> segment.count > 0 }.forEach { segment ->
            val segmentHeight: Float = segment.count / maxValue * chartHeight
            barPaint.color = segment.argb
            canvas.drawRect(left, segmentBottom - segmentHeight, left + barWidth, segmentBottom, barPaint)
            segmentBottom -= segmentHeight
        }
    }
    val baselinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = chartWidgetTrackArgb
        strokeWidth = density
    }
    canvas.drawLine(0f, chartBottom, width, chartBottom, baselinePaint)
    if (usualReviewsPerDay != null && usualReviewsPerDay > 0f) {
        val usualPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = chartWidgetLabelArgb
            strokeWidth = density
            style = Paint.Style.STROKE
            pathEffect = DashPathEffect(floatArrayOf(4f * density, 3f * density), 0f)
        }
        val usualY: Float = chartBottom - usualReviewsPerDay / maxValue * chartHeight
        canvas.drawLine(0f, usualY, width, usualY, usualPaint)
    }
    labelPaint.textAlign = Paint.Align.CENTER
    bars.indices.forEach { index ->
        val centerX: Float = index * slotWidth + slotWidth / 2f
        val firstBaseline: Float = chartBottom + 2f * density - labelPaint.ascent()
        canvas.drawText(weekdayLabels[index], centerX, firstBaseline, labelPaint)
        if (dateLabels == ReviewsChartDateLabels.WEEKDAY_AND_DAY) {
            canvas.drawText(dayLabels[index], centerX, firstBaseline + labelPaint.fontSpacing, labelPaint)
        }
    }
}
