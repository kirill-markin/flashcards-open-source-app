package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Typeface
import android.text.format.DateFormat
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/** The dates and day counts at most; it follows the font scale while the rows have room. */
private val streakBarTextSize: TextUnit = 11.sp
/** A row's height when there is room: a bar that holds the count, and the gap to the next bar. */
private const val streakBarRowHeightPerTextSize: Float = 1.8f
private const val streakBarHeightPerRowHeight: Float = 0.82f
private const val streakBarMaxDateHeightPerRowHeight: Float = 0.8f
private const val streakBarMaxCountHeightPerBarHeight: Float = 0.78f
/** The dates beside each end never take more than this share of the width, so the bars keep the rest. */
private const val streakBarMaxDateWidthFraction: Float = 0.25f
private const val streakBarDateGapDp: Float = 4f

/** A run of consecutive reviewed or frozen days. */
internal data class WidgetStreakRun(
    val startDate: LocalDate,
    val endDate: LocalDate,
    val dayCount: Int,
    val isCurrent: Boolean
)

/**
 * The current streak first, when there is one, then up to [pastRunLimit] earlier streaks found in
 * the history, newest first. The current streak's length is the Progress summary's, because it may
 * be longer than the history; an earlier streak that reaches the first history day may have started
 * before it.
 */
internal fun makeWidgetStreakRuns(content: WidgetProgressContent, pastRunLimit: Int): List<WidgetStreakRun> {
    val historyRuns: List<WidgetStreakRun> = makeHistoryStreakRuns(days = content.days)
    if (content.currentStreakDays == 0) {
        return historyRuns.takeLast(n = pastRunLimit).reversed()
    }
    // A pending today does not break the current streak, which then ends yesterday.
    val todayKeepsStreak: Boolean = content.days.any { day ->
        day.localDate == content.todayLocalDate && isStreakDayState(state = day.streakState)
    }
    val currentEndDate: LocalDate = if (todayKeepsStreak) content.todayLocalDate else content.todayLocalDate.minusDays(1)
    val currentRun = WidgetStreakRun(
        startDate = currentEndDate.minusDays(content.currentStreakDays.toLong() - 1),
        endDate = currentEndDate,
        dayCount = content.currentStreakDays,
        isCurrent = true
    )
    val pastRuns: List<WidgetStreakRun> = historyRuns
        .filter { run -> run.endDate < currentRun.startDate }
        .takeLast(n = pastRunLimit)
        .reversed()
    return listOf(currentRun) + pastRuns
}

/** Oldest first; a missed day or a gap in the dates ends a run, a pending day does not. */
private fun makeHistoryStreakRuns(days: List<WidgetProgressDay>): List<WidgetStreakRun> {
    val runs: MutableList<WidgetStreakRun> = mutableListOf()
    var openRun: WidgetStreakRun? = null
    days.forEach { day ->
        val run: WidgetStreakRun? = openRun
        when (day.streakState) {
            CloudProgressStreakDayState.REVIEWED, CloudProgressStreakDayState.FROZEN -> {
                openRun = if (run != null && run.endDate.plusDays(1) == day.localDate) {
                    run.copy(endDate = day.localDate, dayCount = run.dayCount + 1)
                } else {
                    run?.let(runs::add)
                    WidgetStreakRun(startDate = day.localDate, endDate = day.localDate, dayCount = 1, isCurrent = false)
                }
            }
            CloudProgressStreakDayState.MISSED -> {
                run?.let(runs::add)
                openRun = null
            }
            CloudProgressStreakDayState.PENDING -> Unit
        }
    }
    openRun?.let(runs::add)
    return runs
}

/**
 * One centered bar per run, top to bottom, each as long as its days relative to the longest shown,
 * with the day count inside and the start and end dates beside its ends. The rows fit [size], with text
 * shrunk below [streakBarTextSize] only when they would not; rows center vertically when [size] is taller.
 */
internal fun drawStreakBarsBitmap(
    context: Context,
    runs: List<WidgetStreakRun>,
    accentColor: Color,
    size: DpSize
): Bitmap {
    val displayMetrics = context.resources.displayMetrics
    val density: Float = displayMetrics.density
    val locale: Locale = context.resources.configuration.locales[0]
    val dateFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern(
        DateFormat.getBestDateTimePattern(locale, "MMMd"),
        locale
    )
    val longestDayCount: Int = runs.maxOf { run -> run.dayCount }
    val currentBarArgb: Int = accentColor.toArgb()
    val pastBarArgb: Int = accentColor.copy(alpha = 0.35f).toArgb()
    val currentLabelArgb: Int = widgetFillLabelArgb(fillArgb = currentBarArgb)
    val pastLabelArgb: Int = widgetFillLabelArgb(fillArgb = pastBarArgb)
    return drawWidgetBitmap(size = size, density = density) { canvas ->
        val textSize: Float = widgetTextSizePx(fontSize = streakBarTextSize, displayMetrics = displayMetrics)
        val rowHeight: Float = min(canvas.height.toFloat() / runs.size, textSize * streakBarRowHeightPerTextSize)
        val barHeight: Float = rowHeight * streakBarHeightPerRowHeight
        val rowsTop: Float = (canvas.height - rowHeight * runs.size) / 2
        val dateGap: Float = streakBarDateGapDp * density
        val datePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.textSize = min(textSize, rowHeight * streakBarMaxDateHeightPerRowHeight)
            color = FlashcardsDarkColorScheme.onSurfaceVariant.toArgb()
        }
        val widestDateWidth: Float = runs.maxOf { run ->
            max(
                datePaint.measureText(dateFormatter.format(run.startDate)),
                datePaint.measureText(dateFormatter.format(run.endDate))
            )
        }
        val maxDateWidth: Float = canvas.width * streakBarMaxDateWidthFraction
        if (widestDateWidth > maxDateWidth) {
            datePaint.textSize = datePaint.textSize * maxDateWidth / widestDateWidth
        }
        // The widest bar spans the bar area, so each side keeps room for the widest date shown.
        val dateColumnWidth: Float = min(widestDateWidth, maxDateWidth)
        val barAreaLeft: Float = dateColumnWidth + dateGap
        val barAreaWidth: Float = canvas.width - 2 * barAreaLeft
        val barPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        val countPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textAlign = Paint.Align.CENTER
            this.textSize = min(textSize, barHeight * streakBarMaxCountHeightPerBarHeight)
            typeface = Typeface.DEFAULT_BOLD
        }
        val countTexts: List<String> = runs.map { run -> context.getString(R.string.streaks_widget_day_count, run.dayCount) }
        // A bar keeps half its height beside each end of its count, so the widest count fits the bar area.
        val widestCountWidth: Float = countTexts.maxOf { countText -> countPaint.measureText(countText) }
        val maxCountWidth: Float = barAreaWidth - barHeight
        if (widestCountWidth > maxCountWidth && maxCountWidth > 0f) {
            countPaint.textSize = countPaint.textSize * maxCountWidth / widestCountWidth
        }
        runs.forEachIndexed { index, run ->
            val centerY: Float = rowsTop + rowHeight * index + rowHeight / 2
            val countText: String = countTexts[index]
            val minBarWidth: Float = max(barHeight, countPaint.measureText(countText) + barHeight)
            val barWidth: Float = max(minBarWidth, barAreaWidth * run.dayCount / longestDayCount).coerceAtMost(barAreaWidth)
            val barLeft: Float = barAreaLeft + (barAreaWidth - barWidth) / 2
            val barRight: Float = barLeft + barWidth
            barPaint.color = if (run.isCurrent) currentBarArgb else pastBarArgb
            canvas.drawRoundRect(
                barLeft,
                centerY - barHeight / 2,
                barRight,
                centerY + barHeight / 2,
                barHeight / 2,
                barHeight / 2,
                barPaint
            )
            countPaint.color = if (run.isCurrent) currentLabelArgb else pastLabelArgb
            canvas.drawText(countText, barLeft + barWidth / 2, centeredBaseline(centerY = centerY, paint = countPaint), countPaint)
            val dateBaseline: Float = centeredBaseline(centerY = centerY, paint = datePaint)
            datePaint.textAlign = Paint.Align.RIGHT
            canvas.drawText(dateFormatter.format(run.startDate), barLeft - dateGap, dateBaseline, datePaint)
            datePaint.textAlign = Paint.Align.LEFT
            canvas.drawText(dateFormatter.format(run.endDate), barRight + dateGap, dateBaseline, datePaint)
        }
    }
}
