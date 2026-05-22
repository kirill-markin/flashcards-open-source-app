package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

private const val reviewReactionPathSampleCount: Int = 36

internal fun DrawScope.drawWarningTapeBand(
    center: Offset,
    length: Float,
    height: Float,
    rotationDegrees: Float,
    alpha: Float
) {
    val halfLength: Float = length * 0.50f
    val halfHeight: Float = height * 0.50f
    val bandPoints: List<Offset> = listOf(
        transformLocalPoint(center = center, local = Offset(x = -halfLength, y = -halfHeight), scale = 1f, rotationDegrees = rotationDegrees),
        transformLocalPoint(center = center, local = Offset(x = halfLength, y = -halfHeight), scale = 1f, rotationDegrees = rotationDegrees),
        transformLocalPoint(center = center, local = Offset(x = halfLength, y = halfHeight), scale = 1f, rotationDegrees = rotationDegrees),
        transformLocalPoint(center = center, local = Offset(x = -halfLength, y = halfHeight), scale = 1f, rotationDegrees = rotationDegrees)
    )
    drawPath(path = polygonPath(points = bandPoints), color = reviewReactionYellowColor.copy(alpha = alpha))
    drawPolylineProgress(
        points = listOf(bandPoints[0], bandPoints[1]),
        progress = 1f,
        color = Color.Black.copy(alpha = alpha * 0.42f),
        strokeWidth = 3f
    )
    drawPolylineProgress(
        points = listOf(bandPoints[3], bandPoints[2]),
        progress = 1f,
        color = Color.Black.copy(alpha = alpha * 0.42f),
        strokeWidth = 3f
    )

    val stripeCount: Int = max(6, (length / 56f).toInt())
    for (index in 0..stripeCount) {
        val stripeCenterX: Float = -halfLength + index.toFloat() * length / stripeCount.toFloat()
        val stripeWidth: Float = height * 0.42f
        val stripePoints: List<Offset> = listOf(
            transformLocalPoint(
                center = center,
                local = Offset(x = stripeCenterX - stripeWidth, y = -halfHeight),
                scale = 1f,
                rotationDegrees = rotationDegrees
            ),
            transformLocalPoint(
                center = center,
                local = Offset(x = stripeCenterX, y = -halfHeight),
                scale = 1f,
                rotationDegrees = rotationDegrees
            ),
            transformLocalPoint(
                center = center,
                local = Offset(x = stripeCenterX + stripeWidth, y = halfHeight),
                scale = 1f,
                rotationDegrees = rotationDegrees
            ),
            transformLocalPoint(
                center = center,
                local = Offset(x = stripeCenterX, y = halfHeight),
                scale = 1f,
                rotationDegrees = rotationDegrees
            )
        )
        drawPath(path = polygonPath(points = stripePoints), color = Color.Black.copy(alpha = alpha * 0.70f))
    }
}

internal fun DrawScope.drawWeight(
    center: Offset,
    width: Float,
    height: Float,
    xScale: Float,
    yScale: Float
) {
    val scaledWidth: Float = width * xScale
    val scaledHeight: Float = height * yScale
    drawRoundRect(
        color = Color.Gray,
        topLeft = Offset(x = center.x - scaledWidth * 0.50f, y = center.y - scaledHeight * 0.28f),
        size = Size(width = scaledWidth, height = scaledHeight * 0.72f),
        cornerRadius = CornerRadius(x = scaledHeight * 0.18f, y = scaledHeight * 0.18f)
    )
    drawRoundRect(
        color = Color.DarkGray,
        topLeft = Offset(x = center.x - scaledWidth * 0.18f, y = center.y - scaledHeight * 0.58f),
        size = Size(width = scaledWidth * 0.36f, height = scaledHeight * 0.24f),
        cornerRadius = CornerRadius(x = scaledHeight * 0.08f, y = scaledHeight * 0.08f)
    )
    drawRoundRect(
        color = Color.Black.copy(alpha = 0.20f),
        topLeft = Offset(x = center.x - scaledWidth * 0.32f, y = center.y - scaledHeight * 0.10f),
        size = Size(width = scaledWidth * 0.64f, height = scaledHeight * 0.16f),
        cornerRadius = CornerRadius(x = scaledHeight * 0.08f, y = scaledHeight * 0.08f)
    )
}

internal fun DrawScope.drawImpactLines(
    center: Offset,
    radius: Float,
    progress: Float,
    color: Color
) {
    for (index in 0 until 10) {
        val localProgress: Float = reviewReactionClampedProgress(progress = progress - index.toFloat() * 0.035f)
        val angle: Float = index.toFloat() / 10f * PI.toFloat() * 2f
        val startRadius: Float = radius * 0.48f
        val endRadius: Float = radius * (0.62f + localProgress * 0.50f)
        drawLine(
            color = color.copy(alpha = 1f - localProgress * 0.45f),
            start = Offset(x = center.x + cos(angle) * startRadius, y = center.y + sin(angle) * startRadius),
            end = Offset(x = center.x + cos(angle) * endRadius, y = center.y + sin(angle) * endRadius),
            strokeWidth = 5f,
            cap = StrokeCap.Round
        )
    }
}

internal fun DrawScope.drawBoulder(
    center: Offset,
    radius: Float,
    rotationDegrees: Float
) {
    drawCircle(color = Color.Gray, radius = radius, center = center)
    drawCircle(
        color = Color.Black.copy(alpha = 0.35f),
        radius = radius,
        center = center,
        style = Stroke(width = 5f)
    )
    val cracks: List<List<Offset>> = listOf(
        listOf(Offset(x = -0.30f, y = -0.32f), Offset(x = -0.06f, y = -0.10f), Offset(x = -0.22f, y = 0.10f)),
        listOf(Offset(x = 0.20f, y = -0.30f), Offset(x = 0.02f, y = 0.02f), Offset(x = 0.24f, y = 0.30f)),
        listOf(Offset(x = -0.42f, y = 0.22f), Offset(x = -0.10f, y = 0.34f), Offset(x = 0.06f, y = 0.18f))
    )
    cracks.forEach { crack: List<Offset> ->
        val points: List<Offset> = crack.map { local: Offset ->
            transformLocalPoint(
                center = center,
                local = Offset(x = local.x * radius, y = local.y * radius),
                scale = 1f,
                rotationDegrees = rotationDegrees
            )
        }
        drawPolylineProgress(
            points = points,
            progress = 1f,
            color = Color.Black.copy(alpha = 0.22f),
            strokeWidth = 4f
        )
    }
}

internal fun DrawScope.drawDustCloud(
    center: Offset,
    radius: Float,
    progress: Float
) {
    for (index in 0 until 5) {
        val localProgress: Float = reviewReactionClampedProgress(progress = progress - index.toFloat() * 0.10f)
        drawCircle(
            color = Color.Gray.copy(alpha = 0.35f * (1f - localProgress * 0.65f)),
            radius = radius * (0.16f + localProgress * 0.16f),
            center = Offset(x = center.x - index.toFloat() * radius * 0.14f, y = center.y + sin(index.toFloat()) * radius * 0.08f)
        )
    }
}

internal fun DrawScope.drawCheckMark(
    center: Offset,
    width: Float,
    color: Color,
    lineWidth: Float,
    progress: Float
) {
    val start: Offset = Offset(x = center.x - width * 0.42f, y = center.y + width * 0.02f)
    val middle: Offset = Offset(x = center.x - width * 0.12f, y = center.y + width * 0.28f)
    val end: Offset = Offset(x = center.x + width * 0.48f, y = center.y - width * 0.34f)
    drawSegmentProgress(
        start = start,
        end = middle,
        progress = min(progress * 1.8f, 1f),
        color = Color.Black.copy(alpha = 0.24f),
        strokeWidth = lineWidth + 8f
    )
    drawSegmentProgress(
        start = middle,
        end = end,
        progress = reviewReactionClampedProgress(progress = progress * 1.8f - 0.8f),
        color = Color.Black.copy(alpha = 0.24f),
        strokeWidth = lineWidth + 8f
    )
    drawSegmentProgress(
        start = start,
        end = middle,
        progress = min(progress * 1.8f, 1f),
        color = color,
        strokeWidth = lineWidth
    )
    drawSegmentProgress(
        start = middle,
        end = end,
        progress = reviewReactionClampedProgress(progress = progress * 1.8f - 0.8f),
        color = color,
        strokeWidth = lineWidth
    )
    drawSegmentProgress(
        start = start,
        end = middle,
        progress = min(progress * 1.8f, 1f),
        color = Color.White.copy(alpha = 0.42f),
        strokeWidth = max(2f, lineWidth * 0.22f)
    )
}

internal fun DrawScope.drawBeam(
    center: Offset,
    length: Float,
    height: Float,
    rotationDegrees: Float,
    color: Color
) {
    val points: List<Offset> = listOf(
        transformLocalPoint(center = center, local = Offset(x = -length * 0.50f, y = -height * 0.12f), scale = 1f, rotationDegrees = rotationDegrees),
        transformLocalPoint(center = center, local = Offset(x = length * 0.50f, y = -height * 0.50f), scale = 1f, rotationDegrees = rotationDegrees),
        transformLocalPoint(center = center, local = Offset(x = length * 0.50f, y = height * 0.12f), scale = 1f, rotationDegrees = rotationDegrees),
        transformLocalPoint(center = center, local = Offset(x = -length * 0.50f, y = height * 0.50f), scale = 1f, rotationDegrees = rotationDegrees)
    )
    drawPath(path = polygonPath(points = points), color = color)
}

internal fun DrawScope.drawPaperPlane(
    center: Offset,
    scale: Float,
    rotationDegrees: Float
) {
    val points: List<Offset> = listOf(
        Offset(x = 82f, y = -6f),
        Offset(x = -64f, y = -46f),
        Offset(x = -22f, y = 4f),
        Offset(x = -58f, y = 50f)
    ).map { local: Offset ->
        transformLocalPoint(center = center, local = local, scale = scale, rotationDegrees = rotationDegrees)
    }
    drawPath(path = polygonPath(points = points), color = Color.White.copy(alpha = 0.96f))
    drawPath(
        path = polygonPath(points = points),
        color = reviewReactionGreenColor,
        style = Stroke(width = 4f * scale, join = StrokeJoin.Round)
    )
    drawPolylineProgress(
        points = listOf(points[0], points[2], points[1]),
        progress = 1f,
        color = reviewReactionBlueColor.copy(alpha = 0.54f),
        strokeWidth = 3f * scale
    )
}

internal fun DrawScope.drawScallopedSeal(
    center: Offset,
    radius: Float,
    rotationDegrees: Float,
    fillColor: Color,
    strokeColor: Color
) {
    val sealPath: Path = makeScallopedSealPath(
        center = center,
        radius = radius,
        teeth = 34,
        inset = 0.07f,
        rotationDegrees = rotationDegrees
    )
    drawPath(path = sealPath, color = fillColor.copy(alpha = 0.94f))
    drawPath(
        path = sealPath,
        color = strokeColor,
        style = Stroke(width = max(3f, radius * 0.06f), join = StrokeJoin.Round)
    )
}

internal fun DrawScope.drawSparkle(
    center: Offset,
    radius: Float,
    color: Color
) {
    val path: Path = Path()
    for (index in 0 until 8) {
        val angle: Float = index.toFloat() / 8f * PI.toFloat() * 2f
        val pointRadius: Float = if (index % 2 == 0) radius else radius * 0.34f
        val point: Offset = Offset(
            x = center.x + cos(angle) * pointRadius,
            y = center.y + sin(angle) * pointRadius
        )
        if (index == 0) {
            path.moveTo(x = point.x, y = point.y)
        } else {
            path.lineTo(x = point.x, y = point.y)
        }
    }
    path.close()
    drawPath(path = path, color = color)
}

internal fun DrawScope.drawCrown(
    center: Offset,
    scale: Float,
    rotationDegrees: Float
) {
    val crownPoints: List<Offset> = listOf(
        Offset(x = -58f, y = 34f),
        Offset(x = -48f, y = -30f),
        Offset(x = -18f, y = 6f),
        Offset(x = 0f, y = -48f),
        Offset(x = 18f, y = 6f),
        Offset(x = 48f, y = -30f),
        Offset(x = 58f, y = 34f)
    ).map { local: Offset ->
        transformLocalPoint(center = center, local = local, scale = scale, rotationDegrees = rotationDegrees)
    }
    drawPath(path = polygonPath(points = crownPoints), color = reviewReactionYellowColor)
    drawPath(
        path = polygonPath(points = crownPoints),
        color = reviewReactionOrangeColor,
        style = Stroke(width = 5f * scale, join = StrokeJoin.Round)
    )
    val baseTopLeft: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = -46f, y = 26f),
        scale = scale,
        rotationDegrees = rotationDegrees
    )
    val baseTopRight: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = 46f, y = 26f),
        scale = scale,
        rotationDegrees = rotationDegrees
    )
    drawCircle(color = reviewReactionOrangeColor, radius = 8f * scale, center = baseTopLeft)
    drawCircle(color = reviewReactionOrangeColor, radius = 8f * scale, center = baseTopRight)
}

internal fun DrawScope.drawRefreshGlyph(
    center: Offset,
    radius: Float,
    rotationDegrees: Float,
    color: Color
) {
    drawArc(
        color = color,
        startAngle = rotationDegrees,
        sweepAngle = 250f,
        useCenter = false,
        topLeft = Offset(x = center.x - radius, y = center.y - radius),
        size = Size(width = radius * 2f, height = radius * 2f),
        style = Stroke(width = max(4f, radius * 0.15f), cap = StrokeCap.Round)
    )
    drawArrowTriangle(
        center = Offset(
            x = center.x + cos(degreesToRadians(degrees = rotationDegrees + 250f)) * radius,
            y = center.y + sin(degreesToRadians(degrees = rotationDegrees + 250f)) * radius
        ),
        size = radius * 0.28f,
        rotationDegrees = rotationDegrees + 250f,
        color = color
    )
}

internal fun DrawScope.drawArrowTriangle(
    center: Offset,
    size: Float,
    rotationDegrees: Float,
    color: Color
) {
    val points: List<Offset> = listOf(
        Offset(x = size, y = 0f),
        Offset(x = -size * 0.62f, y = -size * 0.54f),
        Offset(x = -size * 0.62f, y = size * 0.54f)
    ).map { local: Offset ->
        transformLocalPoint(center = center, local = local, scale = 1f, rotationDegrees = rotationDegrees)
    }
    drawPath(path = polygonPath(points = points), color = color)
}

internal fun DrawScope.drawCubicStroke(
    start: Offset,
    control1: Offset,
    control2: Offset,
    end: Offset,
    progress: Float,
    color: Color,
    strokeWidth: Float
) {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    if (clampedProgress <= 0f) {
        return
    }

    var previous: Offset = start
    val steps: Int = max(1, (reviewReactionPathSampleCount * clampedProgress).toInt())
    for (step in 1..steps) {
        val t: Float = clampedProgress * step.toFloat() / steps.toFloat()
        val next: Offset = cubicBezierPoint(
            start = start,
            control1 = control1,
            control2 = control2,
            end = end,
            progress = t
        )
        drawLine(color = color, start = previous, end = next, strokeWidth = strokeWidth, cap = StrokeCap.Round)
        previous = next
    }
}

internal fun DrawScope.drawSpiralStroke(
    center: Offset,
    maxRadius: Float,
    turns: Float,
    rotationRadians: Float,
    progress: Float,
    color: Color,
    strokeWidth: Float
) {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    if (clampedProgress <= 0f) {
        return
    }

    var previous: Offset = center
    val steps: Int = max(1, (reviewReactionPathSampleCount * clampedProgress).toInt())
    for (step in 1..steps) {
        val t: Float = clampedProgress * step.toFloat() / steps.toFloat()
        val angle: Float = t * PI.toFloat() * 2f * turns + rotationRadians
        val radius: Float = maxRadius * t
        val next: Offset = Offset(x = center.x + cos(angle) * radius, y = center.y + sin(angle) * radius)
        drawLine(color = color, start = previous, end = next, strokeWidth = strokeWidth, cap = StrokeCap.Round)
        previous = next
    }
}

internal fun DrawScope.drawPolylineProgress(
    points: List<Offset>,
    progress: Float,
    color: Color,
    strokeWidth: Float
) {
    if (points.size < 2) {
        return
    }

    val totalSegments: Int = points.size - 1
    val scaledProgress: Float = reviewReactionClampedProgress(progress = progress) * totalSegments.toFloat()
    for (index in 0 until totalSegments) {
        val segmentProgress: Float = reviewReactionClampedProgress(progress = scaledProgress - index.toFloat())
        if (segmentProgress <= 0f) {
            continue
        }
        drawSegmentProgress(
            start = points[index],
            end = points[index + 1],
            progress = segmentProgress,
            color = color,
            strokeWidth = strokeWidth
        )
    }
}

private fun DrawScope.drawSegmentProgress(
    start: Offset,
    end: Offset,
    progress: Float,
    color: Color,
    strokeWidth: Float
) {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    if (clampedProgress <= 0f) {
        return
    }

    val currentEnd: Offset = Offset(
        x = reviewReactionInterpolate(start = start.x, end = end.x, progress = clampedProgress),
        y = reviewReactionInterpolate(start = start.y, end = end.y, progress = clampedProgress)
    )
    drawLine(color = color, start = start, end = currentEnd, strokeWidth = strokeWidth, cap = StrokeCap.Round)
}
