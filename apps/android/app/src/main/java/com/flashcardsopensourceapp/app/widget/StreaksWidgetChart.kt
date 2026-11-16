package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Path
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.flashcardsopensourceapp.core.ui.theme.FlashcardsDarkColorScheme
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

internal const val streakDotsDayCount: Int = 7
/** The Progress screen's frozen streak day color. */
private val streakDotsFrozenColor = Color(0xFF90CAF9)
/** The weekday letters at most; they shrink with a narrow widget. */
private val streakDotsLabelTextSize: TextUnit = 10.sp
private const val streakDotsOpenStrokeDp: Float = 1.5f
private const val streakDotsMarkStrokeFraction: Float = 0.16f

/** [state] is null for a day the history does not cover. */
internal data class StreakDot(
    val date: LocalDate,
    val state: CloudProgressStreakDayState?
)

/** The last 7 local days, today last, as the streak saw them. */
internal fun makeStreakDots(content: WidgetProgressContent): List<StreakDot> {
    val statesByDate: Map<LocalDate, CloudProgressStreakDayState> = content.days.associate { day ->
        day.localDate to day.streakState
    }
    return (streakDotsDayCount - 1 downTo 0).map { daysAgo ->
        val date: LocalDate = content.todayLocalDate.minusDays(daysAgo.toLong())
        StreakDot(date = date, state = statesByDate[date])
    }
}

/**
 * One dot per day over its weekday letter: reviewed in the accent with a check, frozen in ice blue
 * with a snowflake, missed faint, and a day still open as an empty ring.
 */
internal fun drawStreakDotsBitmap(
    context: Context,
    dots: List<StreakDot>,
    accentArgb: Int,
    size: DpSize
): Bitmap {
    val displayMetrics = context.resources.displayMetrics
    val density: Float = displayMetrics.density
    val locale: Locale = context.resources.configuration.locales[0]
    val frozenArgb: Int = streakDotsFrozenColor.toArgb()
    val faintArgb: Int = FlashcardsDarkColorScheme.onSurface.copy(alpha = 0.18f).toArgb()
    return drawWidgetBitmap(size = size, density = density) { canvas ->
        val cellWidth: Float = canvas.width.toFloat() / dots.size
        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textAlign = Paint.Align.CENTER
            color = FlashcardsDarkColorScheme.onSurfaceVariant.toArgb()
            textSize = min(widgetTextSizePx(fontSize = streakDotsLabelTextSize, displayMetrics = displayMetrics), cellWidth * 0.6f)
        }
        val labelHeight: Float = labelPaint.fontSpacing
        val dotRadius: Float = min(cellWidth * 0.38f, (canvas.height - labelHeight) / 2f - streakDotsOpenStrokeDp * density)
            .coerceAtLeast(minimumValue = density)
        val dotCenterY: Float = (canvas.height - labelHeight) / 2f
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        dots.forEachIndexed { index, dot ->
            val centerX: Float = cellWidth * index + cellWidth / 2f
            when (dot.state) {
                CloudProgressStreakDayState.REVIEWED -> {
                    fillPaint.color = accentArgb
                    canvas.drawCircle(centerX, dotCenterY, dotRadius, fillPaint)
                    strokePaint.color = widgetFillLabelArgb(fillArgb = accentArgb)
                    strokePaint.strokeWidth = dotRadius * streakDotsMarkStrokeFraction * 2f
                    canvas.drawPath(makeCheckPath(centerX = centerX, centerY = dotCenterY, radius = dotRadius), strokePaint)
                }
                CloudProgressStreakDayState.FROZEN -> {
                    fillPaint.color = frozenArgb
                    canvas.drawCircle(centerX, dotCenterY, dotRadius, fillPaint)
                    strokePaint.color = widgetFillLabelArgb(fillArgb = frozenArgb)
                    strokePaint.strokeWidth = dotRadius * streakDotsMarkStrokeFraction
                    canvas.drawPath(makeSnowflakePath(centerX = centerX, centerY = dotCenterY, radius = dotRadius), strokePaint)
                }
                CloudProgressStreakDayState.PENDING -> {
                    strokePaint.color = FlashcardsDarkColorScheme.onSurfaceVariant.toArgb()
                    strokePaint.strokeWidth = streakDotsOpenStrokeDp * density
                    canvas.drawCircle(centerX, dotCenterY, dotRadius - strokePaint.strokeWidth / 2f, strokePaint)
                }
                CloudProgressStreakDayState.MISSED, null -> {
                    fillPaint.color = faintArgb
                    canvas.drawCircle(centerX, dotCenterY, dotRadius, fillPaint)
                }
            }
            canvas.drawText(
                dot.date.dayOfWeek.getDisplayName(TextStyle.NARROW, locale),
                centerX,
                canvas.height - labelPaint.descent(),
                labelPaint
            )
        }
    }
}

private fun makeCheckPath(centerX: Float, centerY: Float, radius: Float): Path {
    return Path().apply {
        moveTo(centerX - radius * 0.45f, centerY + radius * 0.02f)
        lineTo(centerX - radius * 0.12f, centerY + radius * 0.35f)
        lineTo(centerX + radius * 0.48f, centerY - radius * 0.3f)
    }
}

/** Three crossing strokes, a snowflake that reads at a dot's size. */
private fun makeSnowflakePath(centerX: Float, centerY: Float, radius: Float): Path {
    val armLength: Float = radius * 0.55f
    return Path().apply {
        listOf(90.0, 30.0, -30.0).forEach { degrees ->
            val radians: Double = degrees * PI / 180.0
            val dx: Float = (cos(radians) * armLength).toFloat()
            val dy: Float = (sin(radians) * armLength).toFloat()
            moveTo(centerX - dx, centerY - dy)
            lineTo(centerX + dx, centerY + dy)
        }
    }
}
