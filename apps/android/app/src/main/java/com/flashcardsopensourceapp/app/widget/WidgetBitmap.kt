package com.flashcardsopensourceapp.app.widget

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import kotlin.math.roundToInt

/**
 * Glance has no canvas, so a chart or grid is drawn into one bitmap shown as an image. The bitmap is
 * never larger than the widget [size], which keeps it under the RemoteViews bitmap memory limit.
 * [density] is the display density, `Resources.displayMetrics.density`.
 */
fun drawWidgetBitmap(size: DpSize, density: Float, draw: (Canvas) -> Unit): Bitmap {
    val widthPx: Int = (size.width.value * density).roundToInt()
    val heightPx: Int = (size.height.value * density).roundToInt()
    require(widthPx > 0 && heightPx > 0) {
        "Widget bitmap needs a positive size, got ${widthPx}x$heightPx px for $size at density $density."
    }
    val bitmap: Bitmap = createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
    draw(Canvas(bitmap))
    return bitmap
}

/** Roboto's line height with the font padding a widget TextView keeps, as a multiple of the font size. */
private const val widgetTextLineHeightFactor: Float = 1.33f

/**
 * The height [lineCount] lines of [fontSize] text take at [fontScale], `Configuration.fontScale`, so a
 * layout can keep room for its text and draw a bitmap at the exact size left.
 */
internal fun widgetTextHeight(fontSize: TextUnit, lineCount: Int, fontScale: Float): Dp {
    return (fontSize.value * widgetTextLineHeightFactor * fontScale * lineCount).dp
}
