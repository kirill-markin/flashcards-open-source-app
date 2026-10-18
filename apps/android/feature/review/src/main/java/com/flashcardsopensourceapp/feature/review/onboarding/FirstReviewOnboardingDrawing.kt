package com.flashcardsopensourceapp.feature.review.onboarding

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

internal const val pencilContrastRadius = .75f
internal const val pencilShadowRadius = 3.5f
// Includes the widest pressure, drift, and nib vertex at any tangent angle.
private const val pencilBrushRadius = 6.6f
private const val pencilEnvelopeRadius = pencilBrushRadius + pencilContrastRadius

internal data class PencilMark(val path: Path, val opacity: Float, val strokeWidth: Float?)

private class PencilRandom(seed: UInt) {
    private var bits = seed
    fun next(): Float {
        bits = bits xor (bits shl 13)
        bits = bits xor (bits shr 17)
        bits = bits xor (bits shl 5)
        return bits.toDouble().div(4294967296.0).toFloat()
    }
}

private fun cubic(start: Offset, a: Offset, b: Offset, end: Offset): List<Offset> {
    val length = (a - start).getDistance() + (b - a).getDistance() + (end - b).getDistance()
    val count = ceil(length / .85f).toInt().coerceAtLeast(2)
    return (0..count).map { index ->
        val t = index.toFloat() / count
        val u = 1f - t
        start * (u * u * u) + a * (3 * u * u * t) + b * (3 * u * t * t) + end * (t * t * t)
    }
}

private fun oblong(bounds: Rect, frame: Int): List<Offset> {
    val x = bounds.left + if (frame == 0) 0f else -.7f
    val y = bounds.top + if (frame == 0) 0f else .8f
    val right = x + bounds.width + if (frame == 0) 0f else 1.2f
    val bottom = y + bounds.height + if (frame == 0) 0f else -.3f
    val r = min(bounds.height / 2 + 6.5f, min(bounds.width * .45f, bounds.height * .45f))
    val k = .55228475f
    fun point(px: Float, py: Float) = Offset(px, py)
    return cubic(point(x+r,y), point(x+bounds.width*.4f,y-6), point(x+bounds.width*.7f,y-4), point(right-r,y)) +
        cubic(point(right-r,y), point(right-r+r*k,y), point(right,y+r-r*k), point(right,y+r)) +
        cubic(point(right,y+r), point(right+.7f,y+bounds.height*.45f), point(right+.3f,y+bounds.height*.65f), point(right,bottom-r)) +
        cubic(point(right,bottom-r), point(right,bottom-r+r*k), point(right-r+r*k,bottom), point(right-r,bottom)) +
        cubic(point(right-r,bottom), point(x+bounds.width*.7f,bottom+4), point(x+bounds.width*.3f,bottom+6), point(x+r,bottom)) +
        cubic(point(x+r,bottom), point(x+r-r*k,bottom), point(x,bottom-r+r*k), point(x,bottom-r)) +
        cubic(point(x,bottom-r), point(x-.7f,y+bounds.height*.65f), point(x-.3f,y+bounds.height*.4f), point(x,y+r)) +
        cubic(point(x,y+r), point(x,y+r-r*k), point(x+r-r*k,y), point(x+r,y)) +
        cubic(point(x+r,y), point(x+r+5,y-.7f), point(x+r+10,y-1.2f), point(min(right-r,x+r+15),y-1.3f))
}

private fun pencilStroke(
    points: List<Offset>,
    random: PencilRandom,
    pressureProfile: (Offset) -> Float
): List<PencilMark> = buildList {
    for (index in 1 until points.lastIndex) {
        val delta = points[index + 1] - points[index - 1]
        val length = delta.getDistance()
        if (length < .01f) continue
        val tangent = delta / length
        val normal = Offset(-tangent.y, tangent.x)
        val taper = pressureProfile(points[index])
        val pressure = (.78f + .13f * sin(index * .062f) + random.next() * .19f) * taper
        val drift = (sin(index * .12f) * .5f + (random.next() - .5f) * .7f) * taper
        repeat(4) { strand ->
            if (random.next() >= .14f) {
                val across = (strand / 3f - .5f) * 6.5f * pressure + drift + (random.next() - .5f) * 1.2f * taper
                val center = points[index] + normal * across
                val nibLength = (1.1f + random.next() * 2.4f) * (.35f + .65f * taper)
                val nibWidth = (.35f + random.next() * .85f) * taper
                val chip = random.next() * .6f
                val opacity = .38f + random.next() * .57f
                val vertices = listOf(
                    center - tangent * nibLength,
                    center + normal * nibWidth - tangent * chip,
                    center + tangent * nibLength + normal * (nibWidth * .4f),
                    center + tangent * (nibLength * .6f) - normal * nibWidth,
                    center - tangent * (nibLength * .8f) - normal * (nibWidth * .6f)
                )
                add(PencilMark(Path().apply {
                    moveTo(vertices[0].x, vertices[0].y)
                    vertices.drop(1).forEach { lineTo(it.x, it.y) }
                    close()
                }, opacity, null))
            }
        }
        if (index % 7 == 0 && random.next() > .3f && taper > .85f) {
            val across = (random.next() - .5f) * 6.5f
            val opacity = .25f + random.next() * .4f
            val width = .35f + random.next() * .35f
            add(PencilMark(Path().apply {
                val start = points[index] + normal * across
                moveTo(start.x, start.y)
                for (run in 1..7) {
                    if (index + run >= points.size) break
                    val point = points[index + run] + normal * across
                    lineTo(point.x, point.y)
                }
            }, opacity, width))
        }
    }
}

private fun centeredOutline(target: Rect, frame: Int): List<Offset> {
    val points = oblong(target.inflate(16f), frame)
    val center = Offset(
        (points.minOf { it.x } + points.maxOf { it.x }) / 2f,
        (points.minOf { it.y } + points.maxOf { it.y }) / 2f
    )
    return points.map { it + target.center - center }
}

internal fun firstReviewOnboardingDrawing(
    target: Rect,
    viewport: Size,
    availableTop: Float,
    frame: Int
): List<PencilMark> {
    val random = PencilRandom(if (frame == 0) 7823u else 48191u)
    val outline = centeredOutline(target, frame)
    val wide = target.width > target.height * 2
    val wobble = if (frame == 0) 0f else 1.5f
    val tipX = target.left + target.width * if (wide) .63f else .5f
    val ringTop = outline.filter { kotlin.math.abs(it.x - tipX - wobble) < 10f }.minOf { it.y }
    val apex = Offset(tipX + wobble, ringTop - 17.5f)
    val room = (apex.y - availableTop - 8f).coerceAtLeast(0f)
    val outlineMarks = pencilStroke(outline, random) { 1f }
    if (room < 18f) return outlineMarks
    val arrowScale = (room / 60f).coerceAtMost(1f)
    val finalControl = apex - Offset(0f, 33f * arrowScale)
    val tailY = (apex.y - 94f).coerceAtLeast(availableTop + pencilEnvelopeRadius + 8f)
    val tailX = min(viewport.width - 25f, tipX + (if (wide) 53f else 96f) * arrowScale)
    val bendX = (tipX - (if (wide) 28f else 16f) * arrowScale).coerceAtLeast(15f)
    val headLength = 26f * arrowScale
    val legA = apex + Offset(-headLength * sin(.61f), -headLength * cos(.61f))
    val legBLength = headLength - wobble * .4f * arrowScale
    val legB = apex + Offset(legBLength * sin(.635f), -legBLength * cos(.635f))
    val taper: (Offset) -> Float = { ((it - apex).getDistance() / 11f).coerceIn(.16f, 1f) }
    return outlineMarks +
        pencilStroke(cubic(Offset(tailX, tailY + wobble), Offset(bendX + wobble, tailY - 7f), finalControl, apex), random, taper) +
        pencilStroke(cubic(legA, legA, apex, apex), random, taper) +
        pencilStroke(cubic(legB, legB, apex, apex), random, taper)
}
