package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Typeface
import android.text.format.DateFormat
import android.util.DisplayMetrics
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.flashcardsopensourceapp.app.FlashcardsApplication
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.feature.progress.R as ProgressR
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.first

private const val reviewsChartMediumDayCount: Int = 14
private const val reviewsChartLargeDayCount: Int = 30
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
        val contentFlow = observeWithCurrentAppGraph(
            application = context.applicationContext as FlashcardsApplication,
            observe = ::observeWidgetProgressContent
        )
        val initialContent = contentFlow.first()
        provideContent {
            val progress by contentFlow.collectAsState(initial = initialContent)
            GlanceTheme(colors = chartWidgetColors) {
                ReviewsChartWidgetBody(progress = progress, widgetSize = LocalSize.current)
            }
        }
    }
}

class ReviewsChartWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ReviewsChartWidget()
}

private data class ReviewsChartBarSegment(val count: Int, val argb: Int)

/** [segments] stack bottom to top. */
private data class ReviewsChartBar(val localDate: LocalDate, val segments: List<ReviewsChartBarSegment>)

private data class ReviewsChartSummary(
    val days: List<WidgetProgressDay>,
    val dailyAverage: Float,
    /** Null when the previous period of the same length had no reviews. */
    val trendPercent: Int?
)

private fun makeReviewsChartSummary(progress: WidgetProgressContent, dayCount: Int): ReviewsChartSummary {
    val days: List<WidgetProgressDay> = progress.days.takeLast(n = dayCount)
    require(days.isNotEmpty()) {
        "Progress history ending ${progress.todayLocalDate} has no days for the Reviews chart widget."
    }
    val previousDays: List<WidgetProgressDay> = progress.days.dropLast(n = dayCount).takeLast(n = dayCount)
    val reviewCount: Int = days.sumOf { day -> day.reviewCount }
    val previousReviewCount: Int = previousDays.sumOf { day -> day.reviewCount }
    val trendPercent: Int? = if (previousDays.size < dayCount || previousReviewCount == 0) {
        null
    } else {
        ((reviewCount - previousReviewCount) * 100.0 / previousReviewCount).roundToInt()
    }
    return ReviewsChartSummary(
        days = days,
        dailyAverage = reviewCount.toFloat() / days.size,
        trendPercent = trendPercent
    )
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

@Composable
private fun ColumnScope.ReviewsChartMedium(progress: WidgetProgressContent, widgetSize: DpSize) {
    val fontScale: Float = LocalContext.current.resources.configuration.fontScale
    val summary = makeReviewsChartSummary(progress = progress, dayCount = reviewsChartMediumDayCount)
    val primaryArgb: Int = chartWidgetPrimaryArgb
    // A large font can leave the bars no room under the trend line; the chart then takes its place.
    val showsTrend: Boolean = summary.trendPercent != null && chartWidgetBitmapSize(
        widgetSize = widgetSize,
        reservedHeight = reviewsChartHeaderHeight(showsTrend = true, fontScale = fontScale) + reviewsChartMediumSpacing
    ).height >= chartWidgetMinimumChartHeight
    ReviewsChartHeader(summary = summary, dayCount = reviewsChartMediumDayCount, showsTrend = showsTrend)
    Spacer(modifier = GlanceModifier.height(reviewsChartMediumSpacing))
    ReviewsChartImage(
        bars = summary.days.map { day ->
            ReviewsChartBar(
                localDate = day.localDate,
                segments = listOf(ReviewsChartBarSegment(count = day.reviewCount, argb = primaryArgb))
            )
        },
        dailyAverage = summary.dailyAverage,
        bitmapSize = chartWidgetBitmapSize(
            widgetSize = widgetSize,
            reservedHeight = reviewsChartHeaderHeight(showsTrend = showsTrend, fontScale = fontScale) + reviewsChartMediumSpacing
        )
    )
}

@Composable
private fun ColumnScope.ReviewsChartLarge(progress: WidgetProgressContent, widgetSize: DpSize) {
    val context = LocalContext.current
    val fontScale: Float = context.resources.configuration.fontScale
    val summary = makeReviewsChartSummary(progress = progress, dayCount = reviewsChartLargeDayCount)
    val showsTrend: Boolean = summary.trendPercent != null
    ReviewsChartHeader(summary = summary, dayCount = reviewsChartLargeDayCount, showsTrend = showsTrend)
    Spacer(modifier = GlanceModifier.height(reviewsChartLargeSpacing))
    ReviewsChartImage(
        bars = summary.days.map { day ->
            ReviewsChartBar(
                localDate = day.localDate,
                segments = listOf(
                    ReviewsChartBarSegment(count = day.againCount, argb = reviewsChartAgainColor.toArgb()),
                    ReviewsChartBarSegment(count = day.hardCount, argb = reviewsChartHardColor.toArgb()),
                    ReviewsChartBarSegment(count = day.goodCount, argb = reviewsChartGoodColor.toArgb()),
                    ReviewsChartBarSegment(count = day.easyCount, argb = reviewsChartEasyColor.toArgb())
                )
            )
        },
        dailyAverage = summary.dailyAverage,
        bitmapSize = chartWidgetBitmapSize(
            widgetSize = widgetSize,
            reservedHeight = reviewsChartHeaderHeight(showsTrend = showsTrend, fontScale = fontScale) +
                reviewsChartLargeSpacing * 2 +
                widgetTextHeight(fontSize = chartWidgetLegendFontSize, lineCount = 1, fontScale = fontScale)
        )
    )
    Spacer(modifier = GlanceModifier.height(reviewsChartLargeSpacing))
    Row(modifier = GlanceModifier.fillMaxWidth()) {
        listOf(
            reviewsChartAgainColor to ProgressR.string.progress_reviews_rating_again,
            reviewsChartHardColor to ProgressR.string.progress_reviews_rating_hard,
            reviewsChartGoodColor to ProgressR.string.progress_reviews_rating_good,
            reviewsChartEasyColor to ProgressR.string.progress_reviews_rating_easy
        ).forEach { (color, labelResId) ->
            ChartWidgetLegendItem(
                color = color,
                label = context.getString(labelResId),
                count = null,
                modifier = GlanceModifier.defaultWeight().padding(end = 4.dp)
            )
        }
    }
}

@Composable
private fun ReviewsChartHeader(summary: ReviewsChartSummary, dayCount: Int, showsTrend: Boolean) {
    val context = LocalContext.current
    Text(
        text = context.getString(R.string.reviews_chart_widget_daily_average, summary.dailyAverage.roundToInt()),
        style = chartWidgetHeaderStyle(),
        maxLines = 1
    )
    val trendPercent = summary.trendPercent
    if (!showsTrend || trendPercent == null) {
        return
    }
    val trendResId: Int = if (trendPercent < 0) {
        R.plurals.reviews_chart_widget_trend_down
    } else {
        R.plurals.reviews_chart_widget_trend_up
    }
    Text(
        text = context.resources.getQuantityString(trendResId, dayCount, abs(trendPercent), dayCount),
        style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = reviewsChartTrendFontSize),
        maxLines = 1
    )
}

/** [ReviewsChartHeader]'s height: the daily average line, and the trend line when it shows. */
private fun reviewsChartHeaderHeight(showsTrend: Boolean, fontScale: Float): Dp {
    val averageHeight: Dp = widgetTextHeight(fontSize = chartWidgetHeaderFontSize, lineCount = 1, fontScale = fontScale)
    if (!showsTrend) {
        return averageHeight
    }
    return averageHeight + widgetTextHeight(fontSize = reviewsChartTrendFontSize, lineCount = 1, fontScale = fontScale)
}

@Composable
private fun ColumnScope.ReviewsChartImage(bars: List<ReviewsChartBar>, dailyAverage: Float, bitmapSize: DpSize) {
    val context = LocalContext.current
    val displayMetrics: DisplayMetrics = context.resources.displayMetrics
    val locale: Locale = context.resources.configuration.locales.get(0)
    ChartWidgetImage(
        bitmap = drawWidgetBitmap(size = bitmapSize, density = displayMetrics.density) { canvas ->
            drawReviewsChart(
                canvas = canvas,
                bars = bars,
                dailyAverage = dailyAverage,
                displayMetrics = displayMetrics,
                locale = locale
            )
        }
    )
}

/** Bars scaled to the busiest day or the average, a dashed average line, and dates under the first, middle and last bars. */
private fun drawReviewsChart(
    canvas: Canvas,
    bars: List<ReviewsChartBar>,
    dailyAverage: Float,
    displayMetrics: DisplayMetrics,
    locale: Locale
) {
    val density: Float = displayMetrics.density
    val width: Float = canvas.width.toFloat()
    val height: Float = canvas.height.toFloat()
    val slotWidth: Float = width / bars.size
    val dateFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern(
        DateFormat.getBestDateTimePattern(locale, "MMMd"),
        locale
    )
    val labelIndices: List<Int> = listOf(0, bars.size / 2, bars.lastIndex).distinct()
    val labels: List<String> = labelIndices.map { index -> dateFormatter.format(bars[index].localDate) }
    // The ends are pinned to the edges and the middle label centers on its bar, so three labels as wide as
    // this leave a gap on both sides of the middle one.
    val middleLabelCenter: Float = (bars.size / 2 + 0.5f) * slotWidth
    val labelPaint: Paint = makeChartWidgetLabelPaint(
        displayMetrics = displayMetrics,
        argb = chartWidgetLabelArgb,
        typeface = Typeface.DEFAULT,
        labels = labels,
        maxLabelWidth = (min(middleLabelCenter, width - middleLabelCenter) - 4f * density) * 2f / 3f,
        maxLabelHeight = height * chartWidgetMaxLabelHeightFraction
    )
    val chartTop: Float = density
    val chartBottom: Float = height - labelPaint.fontSpacing - 2f * density
    val chartHeight: Float = chartBottom - chartTop
    val maxValue: Float = max(
        bars.maxOf { bar -> bar.segments.sumOf { segment -> segment.count } }.toFloat(),
        dailyAverage
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
    if (dailyAverage > 0f) {
        val averagePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = chartWidgetLabelArgb
            strokeWidth = density
            style = Paint.Style.STROKE
            pathEffect = DashPathEffect(floatArrayOf(4f * density, 3f * density), 0f)
        }
        val averageY: Float = chartBottom - dailyAverage / maxValue * chartHeight
        canvas.drawLine(0f, averageY, width, averageY, averagePaint)
    }
    labelIndices.zip(labels).forEach { (index, label) ->
        val labelWidth: Float = labelPaint.measureText(label)
        val labelX: Float = (index * slotWidth + (slotWidth - labelWidth) / 2f)
            .coerceIn(minimumValue = 0f, maximumValue = max(0f, width - labelWidth))
        canvas.drawText(label, labelX, height - labelPaint.descent(), labelPaint)
    }
}
