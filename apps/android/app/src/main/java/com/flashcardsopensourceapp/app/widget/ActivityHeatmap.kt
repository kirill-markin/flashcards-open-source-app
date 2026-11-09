package com.flashcardsopensourceapp.app.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.time.temporal.TemporalAdjusters
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.min

internal const val daysPerWeek: Int = 7
private const val maxDaysPerMonth: Int = 31
private const val yearMonthCount: Int = 12
private const val activityLevelCount: Int = 4
/** The share of a cell's pitch left as the gap to its neighbour. */
private const val activityCellGapFraction: Float = 0.18f
private const val activityCellCornerFraction: Float = 0.2f
private val reviewedDayAlphas: List<Float> = listOf(0.3f, 0.5f, 0.75f, 1f)
private val emptyDayColor: Int = FlashcardsDarkColorScheme.onSurface.copy(alpha = 0.1f).toArgb()
/** The ice blue of frozen days in the Progress streak calendar. */
private val frozenDayColor: Int = 0xFF90CAF9.toInt()
private val todayOutlineColor: Int = FlashcardsDarkColorScheme.onSurface.toArgb()
private val monthLabelColor: Int = FlashcardsDarkColorScheme.onSurfaceVariant.toArgb()
private val maxMonthLabelTextSize = 11.dp
/** A Year view row is at least this many label text sizes tall, so labels never overlap. */
private const val monthLabelLineHeightFactor: Float = 1.3f
private val monthLabelGap = 4.dp
private val todayOutlineWidth = 1.dp

/** Level 0 is no reviews; 1–4 is the review-count quartile among the reviewed days drawn with it. */
private data class ActivityDayCell(
    val level: Int,
    val isFrozen: Boolean,
    val isToday: Boolean
)

/** Columns are weeks, oldest first, each from [WidgetProgressContent.firstDayOfWeek]; days after today are left out. */
internal fun activityHeatmapDates(progress: WidgetProgressContent, weekCount: Int): List<LocalDate> {
    val today: LocalDate = progress.todayLocalDate
    val firstDate: LocalDate = today
        .with(TemporalAdjusters.previousOrSame(progress.firstDayOfWeek))
        .minusWeeks(weekCount.toLong() - 1L)
    return (0 until weekCount * daysPerWeek)
        .map { dayIndex -> firstDate.plusDays(dayIndex.toLong()) }
        .filter { date -> date.isAfter(today).not() }
}

/** One Year view row: [dates] are the days of [yearMonth] inside the Progress history window, up to today. */
internal data class YearMonthDates(
    val yearMonth: YearMonth,
    val dates: List<LocalDate>
)

/**
 * The last 12 months, the current one last. The oldest month can start before the Progress history
 * window; its days before the window are unknown, so they are left out like future days.
 */
internal fun yearMonthDates(progress: WidgetProgressContent): List<YearMonthDates> {
    val today: LocalDate = progress.todayLocalDate
    val historyStart: LocalDate = progress.days.first().localDate
    val currentMonth: YearMonth = YearMonth.from(today)
    return (yearMonthCount - 1 downTo 0).map { monthsBack ->
        val month: YearMonth = currentMonth.minusMonths(monthsBack.toLong())
        YearMonthDates(
            yearMonth = month,
            dates = (1..month.lengthOfMonth())
                .map { dayOfMonth -> month.atDay(dayOfMonth) }
                .filter { date -> date.isBefore(historyStart).not() && date.isAfter(today).not() }
        )
    }
}

internal fun sumReviewCounts(progress: WidgetProgressContent, dates: Set<LocalDate>): Int {
    return progress.days.filter { day -> day.localDate in dates }.sumOf { day -> day.reviewCount }
}

internal fun countActiveDays(progress: WidgetProgressContent, dates: Set<LocalDate>): Int {
    return progress.days.count { day -> day.localDate in dates && day.reviewCount > 0 }
}

/**
 * The heatmap of [dates] from [activityHeatmapDates] as square cells, as large as fit in [areaSize];
 * the bitmap is the grid itself, so it can be centred.
 */
internal fun drawActivityHeatmapBitmap(
    progress: WidgetProgressContent,
    dates: List<LocalDate>,
    weekCount: Int,
    areaSize: DpSize,
    density: Float
): Bitmap {
    val pitchDp: Float = min(areaSize.width.value / weekCount, areaSize.height.value / daysPerWeek)
    val gridSize = DpSize(width = (pitchDp * weekCount).dp, height = (pitchDp * daysPerWeek).dp)
    val cells: Map<LocalDate, ActivityDayCell> = makeActivityDayCells(progress = progress, dates = dates)
    return drawWidgetBitmap(size = gridSize, density = density) { canvas ->
        val pitchPx: Float = pitchDp * density
        val gapPx: Float = pitchPx * activityCellGapFraction
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        dates.forEachIndexed { dayIndex, date ->
            val left: Float = (dayIndex / daysPerWeek) * pitchPx + gapPx / 2f
            val top: Float = (dayIndex % daysPerWeek) * pitchPx + gapPx / 2f
            drawActivityCell(
                canvas = canvas,
                cell = cells.getValue(date),
                rect = RectF(left, top, left + pitchPx - gapPx, top + pitchPx - gapPx),
                paint = paint,
                density = density
            )
        }
    }
}

/**
 * One row per entry of [months] from [yearMonthDates]: a short month label, then one cell per day in
 * its day-of-month column. The rows share [areaSize]'s height evenly and the cells are as large as fit
 * in a row; the bitmap is [areaSize] wide only when the cells fill its width.
 */
internal fun drawYearBitmap(
    progress: WidgetProgressContent,
    months: List<YearMonthDates>,
    areaSize: DpSize,
    density: Float
): Bitmap {
    val cells: Map<LocalDate, ActivityDayCell> = makeActivityDayCells(
        progress = progress,
        dates = months.flatMap { month -> month.dates }
    )
    val locale: Locale = Locale.getDefault()
    val rowPitchPx: Float = areaSize.height.value * density / months.size
    val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = monthLabelColor
        textSize = min(rowPitchPx / monthLabelLineHeightFactor, maxMonthLabelTextSize.value * density)
    }
    val labels: List<String> = months.map { month ->
        month.yearMonth.month.getDisplayName(TextStyle.SHORT_STANDALONE, locale)
    }
    val labelWidthPx: Float = labels.maxOf { label -> labelPaint.measureText(label) } + monthLabelGap.value * density
    val columnPitchPx: Float = min((areaSize.width.value * density - labelWidthPx) / maxDaysPerMonth, rowPitchPx)
    val cellSizePx: Float = columnPitchPx * (1f - activityCellGapFraction)
    val gridSize = DpSize(
        width = ((labelWidthPx + columnPitchPx * maxDaysPerMonth) / density).dp,
        height = areaSize.height
    )
    return drawWidgetBitmap(size = gridSize, density = density) { canvas ->
        val cellPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        months.forEachIndexed { rowIndex, month ->
            val rowCenterY: Float = rowIndex * rowPitchPx + rowPitchPx / 2f
            canvas.drawText(
                labels[rowIndex],
                0f,
                rowCenterY - (labelPaint.descent() + labelPaint.ascent()) / 2f,
                labelPaint
            )
            month.dates.forEach { date ->
                val left: Float = labelWidthPx + (date.dayOfMonth - 1) * columnPitchPx + (columnPitchPx - cellSizePx) / 2f
                val top: Float = rowCenterY - cellSizePx / 2f
                drawActivityCell(
                    canvas = canvas,
                    cell = cells.getValue(date),
                    rect = RectF(left, top, left + cellSizePx, top + cellSizePx),
                    paint = cellPaint,
                    density = density
                )
            }
        }
    }
}

/** [dates] lie inside the Progress history window; [yearMonthDates] drops the days before it. */
private fun makeActivityDayCells(progress: WidgetProgressContent, dates: List<LocalDate>): Map<LocalDate, ActivityDayCell> {
    val daysByDate: Map<LocalDate, WidgetProgressDay> = progress.days.associateBy { day -> day.localDate }
    val sortedReviewCounts: List<Int> = dates
        .mapNotNull { date -> daysByDate[date]?.reviewCount }
        .filter { reviewCount -> reviewCount > 0 }
        .sorted()
    return dates.associateWith { date ->
        val day: WidgetProgressDay? = daysByDate[date]
        ActivityDayCell(
            level = activityLevel(reviewCount = day?.reviewCount ?: 0, sortedReviewCounts = sortedReviewCounts),
            isFrozen = day?.streakState == CloudProgressStreakDayState.FROZEN,
            isToday = date == progress.todayLocalDate
        )
    }
}

/** Quartiles of the drawn days rather than fixed counts, so a light user still sees contrast. */
private fun activityLevel(reviewCount: Int, sortedReviewCounts: List<Int>): Int {
    if (reviewCount == 0) {
        return 0
    }
    val countAtOrBelow: Int = sortedReviewCounts.count { otherCount -> otherCount <= reviewCount }
    return ceil(activityLevelCount.toDouble() * countAtOrBelow / sortedReviewCounts.size).toInt()
}

private fun drawActivityCell(canvas: Canvas, cell: ActivityDayCell, rect: RectF, paint: Paint, density: Float) {
    val cornerRadius: Float = rect.width() * activityCellCornerFraction
    paint.style = Paint.Style.FILL
    paint.color = when {
        cell.isFrozen -> frozenDayColor
        cell.level == 0 -> emptyDayColor
        else -> FlashcardsDarkColorScheme.primary.copy(alpha = reviewedDayAlphas[cell.level - 1]).toArgb()
    }
    canvas.drawRoundRect(rect, cornerRadius, cornerRadius, paint)
    if (cell.isToday) {
        val outlineWidth: Float = todayOutlineWidth.value * density
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = outlineWidth
        paint.color = todayOutlineColor
        val outlineRect = RectF(rect).apply { inset(outlineWidth / 2f, outlineWidth / 2f) }
        canvas.drawRoundRect(outlineRect, cornerRadius, cornerRadius, paint)
    }
}
