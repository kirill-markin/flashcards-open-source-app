package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.core.graphics.withClip
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.min

private const val monthCalendarDaysPerWeek: Int = 7
private const val monthCalendarMaxWeekCount: Int = 6
private const val monthCalendarTodayStrokeDp: Float = 1.5f
/** Caps on the large calendar's day marks and text, which otherwise grow with a tall or wide widget. */
private const val monthCalendarMaxMarkHeightDp: Float = 30f
private const val monthCalendarMaxTextSizeDp: Float = 14f
/** The Progress screen's frozen streak day color. */
private val monthCalendarFrozenColor = Color(0xFF90CAF9)

/** [streakState] is null for days the history does not cover, such as future days. */
internal data class MonthCalendarCell(
    val date: LocalDate,
    val streakState: CloudProgressStreakDayState?,
    val isToday: Boolean,
    val isFuture: Boolean
)

/** Today's month as week rows starting at the first weekday; null cells pad days outside the month. */
internal fun makeMonthCalendarWeeks(content: WidgetProgressContent): List<List<MonthCalendarCell?>> {
    val month: YearMonth = YearMonth.from(content.todayLocalDate)
    val statesByDate: Map<LocalDate, CloudProgressStreakDayState> = content.days.associate { day ->
        day.localDate to day.streakState
    }
    val leadingBlankCount: Int = Math.floorMod(
        month.atDay(1).dayOfWeek.value - content.firstDayOfWeek.value,
        monthCalendarDaysPerWeek
    )
    val monthCells: List<MonthCalendarCell> = (1..month.lengthOfMonth()).map { dayOfMonth ->
        val date: LocalDate = month.atDay(dayOfMonth)
        MonthCalendarCell(
            date = date,
            streakState = statesByDate[date],
            isToday = date == content.todayLocalDate,
            isFuture = date > content.todayLocalDate
        )
    }
    val cells: List<MonthCalendarCell?> = List(size = leadingBlankCount) { null } + monthCells
    return cells.chunked(size = monthCalendarDaysPerWeek).map { week ->
        week + List(size = monthCalendarDaysPerWeek - week.size) { null }
    }
}

/** A 7-column dot per day: accent reviewed, ice blue frozen, faint otherwise, today outlined. */
internal fun drawMonthCalendarDotsBitmap(
    context: Context,
    weeks: List<List<MonthCalendarCell?>>,
    size: DpSize
): Bitmap {
    val density: Float = context.resources.displayMetrics.density
    return drawWidgetBitmap(size = size, density = density) { canvas ->
        val cellWidth: Float = canvas.width.toFloat() / monthCalendarDaysPerWeek
        val rowHeight: Float = canvas.height.toFloat() / monthCalendarMaxWeekCount
        val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        val todayPaint = makeTodayPaint(density = density)
        // Today's ring sits one stroke outside the dot; capping the radius keeps it inside the cell.
        val cellExtent: Float = min(cellWidth, rowHeight)
        val dotRadius: Float = min(cellExtent * 0.34f, cellExtent / 2 - todayPaint.strokeWidth * 1.5f)
        weeks.forEachIndexed { weekIndex, week ->
            val centerY: Float = rowHeight * weekIndex + rowHeight / 2
            week.forEachIndexed { dayIndex, cell ->
                if (cell != null) {
                    val centerX: Float = cellWidth * dayIndex + cellWidth / 2
                    dotPaint.color = when (cell.streakState) {
                        CloudProgressStreakDayState.REVIEWED -> FlashcardsDarkColorScheme.primary.toArgb()
                        CloudProgressStreakDayState.FROZEN -> monthCalendarFrozenColor.toArgb()
                        CloudProgressStreakDayState.MISSED,
                        CloudProgressStreakDayState.PENDING,
                        null -> FlashcardsDarkColorScheme.onSurface.copy(alpha = 0.18f).toArgb()
                    }
                    canvas.drawCircle(centerX, centerY, dotRadius, dotPaint)
                    if (cell.isToday) {
                        canvas.drawCircle(centerX, centerY, dotRadius + todayPaint.strokeWidth, todayPaint)
                    }
                }
            }
        }
    }
}

/**
 * A weekday header and day numbers. Consecutive reviewed or frozen days within a week join into one
 * rounded pill colored per day, a single day is a circle, and today is outlined.
 */
internal fun drawMonthCalendarDaysBitmap(
    context: Context,
    weeks: List<List<MonthCalendarCell?>>,
    firstDayOfWeek: DayOfWeek,
    size: DpSize
): Bitmap {
    val density: Float = context.resources.displayMetrics.density
    val locale: Locale = context.resources.configuration.locales[0]
    return drawWidgetBitmap(size = size, density = density) { canvas ->
        val cellWidth: Float = canvas.width.toFloat() / monthCalendarDaysPerWeek
        val rowHeight: Float = canvas.height.toFloat() / (monthCalendarMaxWeekCount + 1)
        val markHeight: Float = min(min(cellWidth, rowHeight) * 0.84f, monthCalendarMaxMarkHeightDp * density)
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textAlign = Paint.Align.CENTER
            textSize = min(markHeight * 0.56f, monthCalendarMaxTextSizeDp * density)
        }
        textPaint.color = FlashcardsDarkColorScheme.onSurfaceVariant.toArgb()
        (0 until monthCalendarDaysPerWeek).forEach { dayIndex ->
            canvas.drawText(
                firstDayOfWeek.plus(dayIndex.toLong()).getDisplayName(TextStyle.NARROW, locale),
                cellWidth * dayIndex + cellWidth / 2,
                centeredBaseline(centerY = rowHeight / 2, paint = textPaint),
                textPaint
            )
        }
        val todayPaint = makeTodayPaint(density = density)
        weeks.forEachIndexed { weekIndex, week ->
            val centerY: Float = rowHeight * (weekIndex + 1) + rowHeight / 2
            drawMonthCalendarWeekPills(
                canvas = canvas,
                week = week,
                centerY = centerY,
                cellWidth = cellWidth,
                markHeight = markHeight
            )
            week.forEachIndexed { dayIndex, cell ->
                if (cell != null) {
                    val centerX: Float = cellWidth * dayIndex + cellWidth / 2
                    if (cell.isToday) {
                        canvas.drawCircle(centerX, centerY, (markHeight - todayPaint.strokeWidth) / 2, todayPaint)
                    }
                    textPaint.color = when {
                        cell.streakState?.let(::isStreakDayState) == true ->
                            FlashcardsDarkColorScheme.onPrimary.toArgb()
                        cell.isFuture -> FlashcardsDarkColorScheme.onSurfaceVariant.toArgb()
                        else -> FlashcardsDarkColorScheme.onSurface.toArgb()
                    }
                    canvas.drawText(
                        context.getString(R.string.month_calendar_widget_day_number, cell.date.dayOfMonth),
                        centerX,
                        centeredBaseline(centerY = centerY, paint = textPaint),
                        textPaint
                    )
                }
            }
        }
    }
}

private fun drawMonthCalendarWeekPills(
    canvas: Canvas,
    week: List<MonthCalendarCell?>,
    centerY: Float,
    cellWidth: Float,
    markHeight: Float
) {
    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    val streakDayIndexes: List<Int> = week.indices.filter { dayIndex ->
        week[dayIndex]?.streakState?.let(::isStreakDayState) == true
    }
    val pills: List<IntRange> = streakDayIndexes.fold(initial = emptyList()) { pills, dayIndex ->
        val lastPill: IntRange? = pills.lastOrNull()
        if (lastPill != null && lastPill.last + 1 == dayIndex) {
            pills.dropLast(n = 1) + listOf(lastPill.first..dayIndex)
        } else {
            pills + listOf(dayIndex..dayIndex)
        }
    }
    pills.forEach { pill ->
        val pillRect = RectF(
            cellWidth * pill.first + (cellWidth - markHeight) / 2,
            centerY - markHeight / 2,
            cellWidth * pill.last + (cellWidth + markHeight) / 2,
            centerY + markHeight / 2
        )
        val pillPath = Path().apply {
            addRoundRect(pillRect, markHeight / 2, markHeight / 2, Path.Direction.CW)
        }
        canvas.withClip(pillPath) {
            pill.forEach { dayIndex ->
                fillPaint.color = when (week[dayIndex]?.streakState) {
                    CloudProgressStreakDayState.FROZEN -> monthCalendarFrozenColor.toArgb()
                    else -> FlashcardsDarkColorScheme.primary.toArgb()
                }
                drawRect(cellWidth * dayIndex, pillRect.top, cellWidth * (dayIndex + 1), pillRect.bottom, fillPaint)
            }
        }
    }
}

private fun makeTodayPaint(density: Float): Paint {
    return Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = monthCalendarTodayStrokeDp * density
        color = FlashcardsDarkColorScheme.onSurface.toArgb()
    }
}
