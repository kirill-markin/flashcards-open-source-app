package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.util.DisplayMetrics
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.Text
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.feature.progress.R as ProgressR
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.TextStyle as DateTextStyle
import java.util.Locale

private val comingUpScheduleStripHeight = 8.dp
private val comingUpHeaderSpacing = 4.dp
private val comingUpScheduleSpacing = 6.dp
/** Between the legend's two columns, at font scale 1.0; it grows with the font so a count never meets the next marker. */
private val comingUpLegendColumnGap = 8.dp

// Copy of reviewScheduleBucketColors in feature/progress ProgressReviewScheduleSection.kt (docs/progress-pie-palette.md).
private val comingUpScheduleBucketColors: Map<ProgressReviewScheduleBucketKey, Color> = mapOf(
    ProgressReviewScheduleBucketKey.NEW to Color(0xFFF4C430),
    ProgressReviewScheduleBucketKey.TODAY to Color(0xFFD7263D),
    ProgressReviewScheduleBucketKey.DAYS_1_TO_7 to Color(0xFF1FB5C1),
    ProgressReviewScheduleBucketKey.DAYS_8_TO_30 to Color(0xFF8E5BD9),
    ProgressReviewScheduleBucketKey.DAYS_31_TO_90 to Color(0xFF2BB673),
    ProgressReviewScheduleBucketKey.DAYS_91_TO_360 to Color(0xFFE69F00),
    ProgressReviewScheduleBucketKey.YEARS_1_TO_2 to Color(0xFF3F7CC8),
    ProgressReviewScheduleBucketKey.LATER to Color(0xFF7A8088)
)

class ComingUpWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = chartWidgetSizeMode

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideStyledWidgetContent(context = context, observe = ::observeWidgetContent) { content ->
            ComingUpWidgetBody(content = content, widgetSize = LocalSize.current)
        }
    }
}

class ComingUpWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ComingUpWidget()
}

private data class ComingUpBar(val localDate: LocalDate, val count: Int)

/**
 * Today's bar is the cards due now; the others are the cards falling due that day. Forecast days on
 * or before Progress's today are dropped: the forecast and Progress read the clock separately, so
 * around midnight they can disagree on which day is today. Today's bar is dated the day before the
 * first forecast day, so the weekday labels stay consecutive whichever clock is ahead.
 */
private fun makeComingUpBars(dueNowCount: Int, progress: WidgetProgressContent): List<ComingUpBar> {
    val forecastBars: List<ComingUpBar> = progress.dueForecast.days
        .filter { day -> day.localDate > progress.todayLocalDate }
        .map { day -> ComingUpBar(localDate = day.localDate, count = day.dueCount) }
    val today: LocalDate = forecastBars.firstOrNull()?.localDate?.minusDays(1L) ?: progress.todayLocalDate
    return listOf(ComingUpBar(localDate = today, count = dueNowCount)) + forecastBars
}

@Composable
private fun ComingUpWidgetBody(content: WidgetContent?, widgetSize: DpSize) {
    val size: ReviewWidgetSize = chartWidgetSize(size = widgetSize)
    val queue: ReviewWidgetContent? = content?.queue
    val progress: WidgetProgressContent? = content?.progress
    ChartWidgetScaffold(size = size, kind = WidgetKind.COMING_UP) {
        if (queue == null || progress == null) {
            ChartWidgetOpenApp()
        } else {
            val bars: List<ComingUpBar> = makeComingUpBars(dueNowCount = queue.dueCount, progress = progress)
            val fontScale: Float = LocalContext.current.resources.configuration.fontScale
            // A large font can leave the bars no room under the schedule; they then take its place.
            val reviewSchedule: List<CloudProgressReviewScheduleBucket>? = progress.reviewSchedule?.takeIf { buckets ->
                size == ReviewWidgetSize.LARGE && chartWidgetBitmapSize(
                    widgetSize = widgetSize,
                    reservedHeight = comingUpHeaderHeight(fontScale = fontScale) +
                        comingUpScheduleHeight(bucketCount = buckets.size, fontScale = fontScale)
                ).height >= chartWidgetMinimumChartHeight
            }
            if (reviewSchedule != null) {
                ComingUpBarsSection(
                    bars = bars,
                    widgetSize = widgetSize,
                    reservedScheduleHeight = comingUpScheduleHeight(bucketCount = reviewSchedule.size, fontScale = fontScale)
                )
                ComingUpScheduleSection(buckets = reviewSchedule, widgetSize = widgetSize)
            } else {
                ComingUpBarsSection(bars = bars, widgetSize = widgetSize, reservedScheduleHeight = 0.dp)
            }
        }
    }
}

/** [ComingUpBarsSection]'s header line and the spacing under it. */
private fun comingUpHeaderHeight(fontScale: Float): Dp {
    return widgetTextHeight(fontSize = chartWidgetHeaderFontSize, lineCount = 1, fontScale = fontScale) + comingUpHeaderSpacing
}

/** [ComingUpScheduleSection]'s height: the strip and a legend row for every two buckets. */
private fun comingUpScheduleHeight(bucketCount: Int, fontScale: Float): Dp {
    val legendRowCount: Int = (bucketCount + 1) / 2
    return comingUpScheduleSpacing * 2 + comingUpScheduleStripHeight +
        widgetTextHeight(fontSize = chartWidgetLegendFontSize, lineCount = legendRowCount, fontScale = fontScale)
}

@Composable
private fun ColumnScope.ComingUpBarsSection(bars: List<ComingUpBar>, widgetSize: DpSize, reservedScheduleHeight: Dp) {
    val context = LocalContext.current
    val displayMetrics: DisplayMetrics = context.resources.displayMetrics
    val fontScale: Float = context.resources.configuration.fontScale
    val locale: Locale = context.resources.configuration.locales.get(0)
    val totalCount: Int = bars.sumOf { bar -> bar.count }
    Text(
        text = context.resources.getQuantityString(R.plurals.coming_up_widget_header, totalCount, totalCount),
        style = chartWidgetHeaderStyle(),
        maxLines = 1
    )
    Spacer(modifier = GlanceModifier.height(comingUpHeaderSpacing))
    val accentArgb: Int = widgetAccentColor().toArgb()
    ChartWidgetImage(
        bitmap = drawWidgetBitmap(
            size = chartWidgetBitmapSize(
                widgetSize = widgetSize,
                reservedHeight = comingUpHeaderHeight(fontScale = fontScale) + reservedScheduleHeight
            ),
            density = displayMetrics.density
        ) { canvas ->
            drawComingUpBars(
                canvas = canvas,
                bars = bars,
                displayMetrics = displayMetrics,
                locale = locale,
                accentArgb = accentArgb
            )
        }
    )
}

@Composable
private fun ColumnScope.ComingUpScheduleSection(buckets: List<CloudProgressReviewScheduleBucket>, widgetSize: DpSize) {
    val context = LocalContext.current
    val density: Float = context.resources.displayMetrics.density
    val fontScale: Float = context.resources.configuration.fontScale
    val numberFormat: NumberFormat = NumberFormat.getIntegerInstance(context.resources.configuration.locales.get(0))
    val orderedBuckets: List<CloudProgressReviewScheduleBucket> = buckets.sortedBy { bucket ->
        ProgressReviewScheduleBucketKey.orderedEntries.indexOf(bucket.key)
    }
    Spacer(modifier = GlanceModifier.height(comingUpScheduleSpacing))
    Image(
        provider = ImageProvider(
            bitmap = drawWidgetBitmap(
                size = DpSize(
                    width = chartWidgetBitmapSize(widgetSize = widgetSize, reservedHeight = 0.dp).width,
                    height = comingUpScheduleStripHeight
                ),
                density = density
            ) { canvas ->
                drawReviewScheduleStrip(canvas = canvas, buckets = orderedBuckets)
            }
        ),
        contentDescription = null,
        contentScale = ContentScale.FillBounds,
        modifier = GlanceModifier.fillMaxWidth().height(comingUpScheduleStripHeight)
    )
    Spacer(modifier = GlanceModifier.height(comingUpScheduleSpacing))
    orderedBuckets.chunked(size = 2).forEach { rowBuckets ->
        Row(modifier = GlanceModifier.fillMaxWidth()) {
            rowBuckets.forEach { bucket ->
                ChartWidgetLegendItem(
                    color = comingUpScheduleBucketColors.getValue(bucket.key),
                    label = context.getString(reviewScheduleBucketLabelResId(bucketKey = bucket.key)),
                    count = numberFormat.format(bucket.count.toLong()),
                    modifier = GlanceModifier.defaultWeight().padding(end = comingUpLegendColumnGap * fontScale)
                )
            }
        }
    }
}

/** A count above each bar and the short weekday below it; today's bar is full colour. */
private fun drawComingUpBars(
    canvas: Canvas,
    bars: List<ComingUpBar>,
    displayMetrics: DisplayMetrics,
    locale: Locale,
    accentArgb: Int
) {
    val density: Float = displayMetrics.density
    val width: Float = canvas.width.toFloat()
    val height: Float = canvas.height.toFloat()
    val slotWidth: Float = width / bars.size
    val numberFormat: NumberFormat = NumberFormat.getIntegerInstance(locale)
    val countLabels: List<String> = bars.map { bar -> numberFormat.format(bar.count.toLong()) }
    val weekdayLabels: List<String> = bars.map { bar -> bar.localDate.dayOfWeek.getDisplayName(DateTextStyle.SHORT, locale) }
    val maxLabelWidth: Float = slotWidth - 2f * density
    val maxLabelHeight: Float = height * chartWidgetMaxLabelHeightFraction
    val labelPaint: Paint = makeChartWidgetLabelPaint(
        displayMetrics = displayMetrics,
        argb = chartWidgetLabelArgb,
        typeface = Typeface.DEFAULT,
        labels = weekdayLabels,
        maxLabelWidth = maxLabelWidth,
        maxLabelHeight = maxLabelHeight
    )
    val countPaint: Paint = makeChartWidgetLabelPaint(
        displayMetrics = displayMetrics,
        argb = chartWidgetLabelArgb,
        typeface = Typeface.DEFAULT_BOLD,
        labels = countLabels,
        maxLabelWidth = maxLabelWidth,
        maxLabelHeight = maxLabelHeight
    )
    val chartTop: Float = countPaint.fontSpacing + 2f * density
    val chartBottom: Float = height - labelPaint.fontSpacing - 2f * density
    val chartHeight: Float = chartBottom - chartTop
    val maxCount: Float = bars.maxOf { bar -> bar.count }.toFloat().coerceAtLeast(minimumValue = 1f)
    val barWidth: Float = slotWidth * 0.56f
    val barPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    val baselinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = chartWidgetTrackArgb
        strokeWidth = density
    }
    canvas.drawLine(0f, chartBottom, width, chartBottom, baselinePaint)
    bars.forEachIndexed { index, bar ->
        val slotCenter: Float = index * slotWidth + slotWidth / 2f
        val barTop: Float = chartBottom - bar.count / maxCount * chartHeight
        if (bar.count > 0) {
            barPaint.color = accentArgb
            barPaint.alpha = if (index == 0) 255 else 150
            val cornerRadius: Float = 2f * density
            canvas.drawRoundRect(
                RectF(slotCenter - barWidth / 2f, barTop, slotCenter + barWidth / 2f, chartBottom),
                cornerRadius,
                cornerRadius,
                barPaint
            )
        }
        val countLabel: String = countLabels[index]
        canvas.drawText(
            countLabel,
            slotCenter - countPaint.measureText(countLabel) / 2f,
            barTop - 2f * density - countPaint.descent(),
            countPaint
        )
        val weekdayLabel: String = weekdayLabels[index]
        canvas.drawText(
            weekdayLabel,
            slotCenter - labelPaint.measureText(weekdayLabel) / 2f,
            height - labelPaint.descent(),
            labelPaint
        )
    }
}

/** The buckets side by side in proportion to their card counts, as one rounded strip. */
private fun drawReviewScheduleStrip(canvas: Canvas, buckets: List<CloudProgressReviewScheduleBucket>) {
    val width: Float = canvas.width.toFloat()
    val height: Float = canvas.height.toFloat()
    val clipPath = Path().apply {
        addRoundRect(RectF(0f, 0f, width, height), height / 2f, height / 2f, Path.Direction.CW)
    }
    canvas.clipPath(clipPath)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = chartWidgetTrackArgb }
    canvas.drawRect(0f, 0f, width, height, paint)
    val totalCount: Int = buckets.sumOf { bucket -> bucket.count }
    if (totalCount == 0) {
        return
    }
    var left = 0f
    buckets.filter { bucket -> bucket.count > 0 }.forEach { bucket ->
        val bucketWidth: Float = width * bucket.count / totalCount
        paint.color = comingUpScheduleBucketColors.getValue(bucket.key).toArgb()
        canvas.drawRect(left, 0f, left + bucketWidth, height, paint)
        left += bucketWidth
    }
}

private fun reviewScheduleBucketLabelResId(bucketKey: ProgressReviewScheduleBucketKey): Int {
    return when (bucketKey) {
        ProgressReviewScheduleBucketKey.NEW -> ProgressR.string.progress_review_schedule_bucket_new
        ProgressReviewScheduleBucketKey.TODAY -> ProgressR.string.progress_review_schedule_bucket_today
        ProgressReviewScheduleBucketKey.DAYS_1_TO_7 -> ProgressR.string.progress_review_schedule_bucket_days_1_to_7
        ProgressReviewScheduleBucketKey.DAYS_8_TO_30 -> ProgressR.string.progress_review_schedule_bucket_days_8_to_30
        ProgressReviewScheduleBucketKey.DAYS_31_TO_90 -> ProgressR.string.progress_review_schedule_bucket_days_31_to_90
        ProgressReviewScheduleBucketKey.DAYS_91_TO_360 -> ProgressR.string.progress_review_schedule_bucket_days_91_to_360
        ProgressReviewScheduleBucketKey.YEARS_1_TO_2 -> ProgressR.string.progress_review_schedule_bucket_years_1_to_2
        ProgressReviewScheduleBucketKey.LATER -> ProgressR.string.progress_review_schedule_bucket_later
    }
}
