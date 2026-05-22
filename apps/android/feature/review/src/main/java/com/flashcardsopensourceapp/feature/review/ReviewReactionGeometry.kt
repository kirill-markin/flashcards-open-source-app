package com.flashcardsopensourceapp.feature.review

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

internal fun polygonPath(points: List<Offset>): Path {
    val path: Path = Path()
    points.forEachIndexed { index: Int, point: Offset ->
        if (index == 0) {
            path.moveTo(x = point.x, y = point.y)
        } else {
            path.lineTo(x = point.x, y = point.y)
        }
    }
    path.close()
    return path
}

internal fun makeScallopedSealPath(
    center: Offset,
    radius: Float,
    teeth: Int,
    inset: Float,
    rotationDegrees: Float
): Path {
    require(teeth > 2) {
        "Review reaction seal requires more than two teeth, received $teeth."
    }
    val path: Path = Path()
    val totalPoints: Int = teeth * 2
    for (index in 0 until totalPoints) {
        val localRadius: Float = if (index % 2 == 0) radius else radius * (1f - inset)
        val angle: Float = index.toFloat() / totalPoints.toFloat() * PI.toFloat() * 2f + degreesToRadians(degrees = rotationDegrees)
        val point: Offset = Offset(
            x = center.x + cos(angle) * localRadius,
            y = center.y + sin(angle) * localRadius
        )
        if (index == 0) {
            path.moveTo(x = point.x, y = point.y)
        } else {
            path.lineTo(x = point.x, y = point.y)
        }
    }
    path.close()
    return path
}

internal fun transformLocalPoint(
    center: Offset,
    local: Offset,
    scale: Float,
    rotationDegrees: Float
): Offset {
    val radians: Float = degreesToRadians(degrees = rotationDegrees)
    val scaledX: Float = local.x * scale
    val scaledY: Float = local.y * scale
    return Offset(
        x = center.x + scaledX * cos(radians) - scaledY * sin(radians),
        y = center.y + scaledX * sin(radians) + scaledY * cos(radians)
    )
}

internal fun cubicBezierPoint(
    start: Offset,
    control1: Offset,
    control2: Offset,
    end: Offset,
    progress: Float
): Offset {
    val t: Float = reviewReactionClampedProgress(progress = progress)
    val inverseT: Float = 1f - t
    val startWeight: Float = inverseT * inverseT * inverseT
    val control1Weight: Float = 3f * inverseT * inverseT * t
    val control2Weight: Float = 3f * inverseT * t * t
    val endWeight: Float = t * t * t
    return Offset(
        x = start.x * startWeight + control1.x * control1Weight + control2.x * control2Weight + end.x * endWeight,
        y = start.y * startWeight + control1.y * control1Weight + control2.y * control2Weight + end.y * endWeight
    )
}
internal fun degreesToRadians(degrees: Float): Float {
    return degrees / 180f * PI.toFloat()
}
