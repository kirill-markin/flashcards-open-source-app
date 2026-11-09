package com.flashcardsopensourceapp.app.widget

import android.content.Context
import android.graphics.Paint
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState

/** The Streaks and Month calendar widgets' padding on every side, around their content column. */
internal val widgetContentPadding: Dp = 12.dp

/** A text line's height for its font size, generous so an image drawn below it never overflows. */
private const val widgetTextLineHeightRatio: Float = 1.3f

/** A reviewed or frozen day keeps a streak. */
internal fun isStreakDayState(state: CloudProgressStreakDayState): Boolean {
    return state == CloudProgressStreakDayState.REVIEWED || state == CloudProgressStreakDayState.FROZEN
}

/** The baseline that centers [paint]'s text vertically on [centerY]. */
internal fun centeredBaseline(centerY: Float, paint: Paint): Float {
    return centerY - (paint.descent() + paint.ascent()) / 2
}

/**
 * The image area left in a [widgetSize] widget below one header line of [headerFontSize] text and
 * [headerSpacing], so its bitmap is drawn at the size it is shown at instead of being scaled.
 */
internal fun widgetImageSize(
    context: Context,
    widgetSize: DpSize,
    headerFontSize: TextUnit,
    headerSpacing: Dp
): DpSize {
    val displayMetrics = context.resources.displayMetrics
    val headerFontSizeDp: Float =
        widgetTextSizePx(fontSize = headerFontSize, displayMetrics = displayMetrics) / displayMetrics.density
    val headerHeight: Dp = (headerFontSizeDp * widgetTextLineHeightRatio).dp + headerSpacing
    return DpSize(
        width = (widgetSize.width - widgetContentPadding * 2).coerceAtLeast(1.dp),
        height = (widgetSize.height - widgetContentPadding * 2 - headerHeight).coerceAtLeast(1.dp)
    )
}
