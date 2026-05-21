package com.flashcardsopensourceapp.feature.review

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

private const val reviewReactionAnimationMinimumProgress: Float = 0f
private const val reviewReactionAnimationMaximumProgress: Float = 1f
private const val reviewReactionCleanupExtraMillis: Long = 80L
private const val reviewReactionReducedMotionDrawingProgress: Float = 0.55f
private const val reviewReactionPathSampleCount: Int = 36

private val reviewReactionRedColor: Color = Color(red = 0.96f, green = 0.13f, blue = 0.17f)
private val reviewReactionOrangeColor: Color = Color(red = 1.00f, green = 0.50f, blue = 0.10f)
private val reviewReactionYellowColor: Color = Color(red = 1.00f, green = 0.82f, blue = 0.14f)
private val reviewReactionGreenColor: Color = Color(red = 0.12f, green = 0.76f, blue = 0.34f)
private val reviewReactionBlueColor: Color = Color(red = 0.16f, green = 0.62f, blue = 1.00f)
private val reviewReactionPurpleColor: Color = Color(red = 0.58f, green = 0.34f, blue = 0.98f)
private val reviewReactionPinkColor: Color = Color(red = 1.00f, green = 0.32f, blue = 0.68f)

private data class ReviewReactionPhaseProgress(
    val enter: Float,
    val hold: Float,
    val exit: Float
)

@Composable
internal fun ReviewReactionOverlay(
    modifier: Modifier,
    events: List<ReviewReactionEvent>,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (String) -> Unit
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
    ) {
        events.forEach { event: ReviewReactionEvent ->
            key(event.id) {
                ReviewReactionCanvas(
                    event = event,
                    motionMode = motionMode,
                    onEventFinished = onEventFinished
                )
            }
        }
    }
}

@Composable
private fun ReviewReactionCanvas(
    event: ReviewReactionEvent,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (String) -> Unit
) {
    val durationMillis: Int = reviewReactionAnimationDurationMillis(
        variant = event.variant,
        motionMode = motionMode
    )

    if (motionMode == ReviewReactionMotionMode.REDUCED) {
        LaunchedEffect(event.id) {
            delay(timeMillis = durationMillis.toLong())
            onEventFinished(event.id)
        }

        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    this.alpha = 1f
                }
        ) {
            drawReviewReaction(
                event = event,
                progress = reviewReactionReducedMotionDrawingProgress,
                motionMode = motionMode
            )
        }
        return
    }

    val progress: Animatable<Float, AnimationVector1D> = remember(event.id) {
        Animatable(initialValue = reviewReactionAnimationMinimumProgress)
    }

    LaunchedEffect(event.id) {
        progress.snapTo(targetValue = reviewReactionAnimationMinimumProgress)
        progress.animateTo(
            targetValue = reviewReactionAnimationMaximumProgress,
            animationSpec = tween(
                durationMillis = durationMillis,
                easing = LinearEasing
            )
        )
        delay(timeMillis = reviewReactionCleanupExtraMillis)
        onEventFinished(event.id)
    }

    val currentProgress: Float = progress.value
    val drawingProgress: Float = reviewReactionClampedProgress(progress = currentProgress)
    val alpha: Float = reviewReactionOpacity(progress = currentProgress)

    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.alpha = alpha
            }
    ) {
        drawReviewReaction(
            event = event,
            progress = drawingProgress,
            motionMode = motionMode
        )
    }
}

private fun reviewReactionOpacity(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    if (clampedProgress < 0.12f) {
        return reviewReactionClampedProgress(progress = clampedProgress / 0.12f)
    }
    if (clampedProgress > 0.88f) {
        return reviewReactionClampedProgress(progress = (1f - clampedProgress) / 0.12f)
    }
    return 1f
}

private fun DrawScope.drawReviewReaction(
    event: ReviewReactionEvent,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (event.variant) {
        ReviewReactionVariant.AGAIN_RED_SCRIBBLE_SLASH -> drawAgainRedScribbleSlash(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.AGAIN_REWIND_VORTEX -> drawAgainRewindVortex(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.AGAIN_STAMP_FLYBY -> drawAgainStampFlyby(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.AGAIN_WARNING_TAPE -> drawAgainWarningTape(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_HOURGLASS_SAND -> drawHardHourglassSand(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_FALLING_WEIGHT -> drawHardFallingWeight(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_YELLOW_CRACK -> drawHardYellowCrack(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.HARD_ROLLING_BOULDER -> drawHardRollingBoulder(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.GOOD_HAND_DRAWN_CHECK -> drawGoodHandDrawnCheck(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.GOOD_LIGHT_SWEEP -> drawGoodLightSweep(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.GOOD_PAPER_PLANE_CHECK -> drawGoodPaperPlaneCheck(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.GOOD_CHECK_SEAL_BOUNCE -> drawGoodCheckSealBounce(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_SPARKLE_BURST -> drawEasySparkleBurst(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_RAINBOW_STREAK -> drawEasyRainbowStreak(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_CROWN_BOUNCE -> drawEasyCrownBounce(
            progress = progress,
            motionMode = motionMode
        )

        ReviewReactionVariant.EASY_UNICORN_FLYBY -> drawEasyUnicornFlyby(
            progress = progress,
            motionMode = motionMode
        )
    }
}

private fun DrawScope.drawAgainRedScribbleSlash(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.70f,
        exitStart = 0.82f
    )
    val width: Float = size.width
    val height: Float = size.height
    val offsets: List<Float> = listOf(-12f, 7f, 19f)
    offsets.forEachIndexed { index: Int, offset: Float ->
        val stagger: Float = index.toFloat() * 0.12f
        val drawProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            1f
        } else {
            reviewReactionClampedProgress(progress = (phase.enter - stagger) / 0.72f)
        }
        val shake: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            0f
        } else {
            sin(progress * PI.toFloat() * 16f + index.toFloat() * 1.7f) * 4f * (1f - phase.exit)
        }
        drawCubicStroke(
            start = Offset(x = width * 0.16f, y = height * 0.20f + offset + shake),
            control1 = Offset(x = width * 0.28f, y = height * 0.26f + offset * 0.6f - shake),
            control2 = Offset(x = width * 0.64f, y = height * 0.70f - offset * 0.4f + shake),
            end = Offset(x = width * 0.84f, y = height * 0.78f + offset * 0.35f - shake * 0.6f),
            progress = drawProgress,
            color = reviewReactionRedColor,
            strokeWidth = 13f + index.toFloat() * 2f
        )
        drawCubicStroke(
            start = Offset(x = width * 0.16f, y = height * 0.20f + offset + shake),
            control1 = Offset(x = width * 0.28f, y = height * 0.26f + offset * 0.6f - shake),
            control2 = Offset(x = width * 0.64f, y = height * 0.70f - offset * 0.4f + shake),
            end = Offset(x = width * 0.84f, y = height * 0.78f + offset * 0.35f - shake * 0.6f),
            progress = drawProgress,
            color = Color.White.copy(alpha = 0.52f),
            strokeWidth = 4f + index.toFloat()
        )
    }
}

private fun DrawScope.drawAgainRewindVortex(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.46f,
        exitStart = 0.78f
    )
    val centerWaveX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 2f) * 10f * (1f - phase.exit)
    }
    val centerWaveY: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        cos(progress * PI.toFloat() * 2f) * 6f * (1f - phase.exit)
    }
    val center: Offset = Offset(
        x = size.width * 0.50f + centerWaveX,
        y = size.height * 0.45f + centerWaveY
    )
    val radiusPulse: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.76f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.55f) * 0.24f +
            sin(progress * PI.toFloat() * 4f) * 0.04f
    }
    val maxRadius: Float = min(size.width, size.height) * 0.31f * radiusPulse
    val drawProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionClampedProgress(progress = phase.enter + phase.hold * 0.20f)
    }
    val rotation: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        reviewReactionEaseOutCubic(progress = progress) * PI.toFloat() * 2.35f
    }
    val colors: List<Color> = listOf(reviewReactionRedColor, reviewReactionOrangeColor, reviewReactionPinkColor)
    colors.forEachIndexed { index: Int, color: Color ->
        drawSpiralStroke(
            center = center,
            maxRadius = maxRadius - index.toFloat() * 22f,
            turns = 2.25f,
            rotationRadians = rotation + index.toFloat() * 0.64f,
            progress = drawProgress,
            color = color,
            strokeWidth = 9f
        )
    }
    drawArrowTriangle(
        center = Offset(x = center.x - maxRadius * 0.58f, y = center.y - maxRadius * 0.12f),
        size = maxRadius * 0.22f,
        rotationDegrees = -132f + progress * 120f,
        color = reviewReactionRedColor
    )
    drawArrowTriangle(
        center = Offset(x = center.x + maxRadius * 0.44f, y = center.y + maxRadius * 0.24f),
        size = maxRadius * 0.18f,
        rotationDegrees = 42f + progress * 120f,
        color = reviewReactionOrangeColor
    )
}

private fun DrawScope.drawAgainStampFlyby(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.38f,
        exitStart = 0.76f
    )
    val targetCenter: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.42f)
    val center: Offset = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        targetCenter
    } else if (progress < 0.38f) {
        cubicBezierPoint(
            start = Offset(x = size.width * -0.24f, y = size.height * 0.62f),
            control1 = Offset(x = size.width * 0.08f, y = size.height * 0.18f),
            control2 = Offset(x = size.width * 0.34f, y = size.height * 0.24f),
            end = targetCenter,
            progress = reviewReactionEaseOutCubic(progress = phase.enter)
        )
    } else if (progress < 0.76f) {
        val settle: Float = sin(phase.hold * PI.toFloat() * 3f) * (1f - phase.hold)
        Offset(x = targetCenter.x + settle * 14f, y = targetCenter.y - abs(settle) * 10f)
    } else {
        cubicBezierPoint(
            start = targetCenter,
            control1 = Offset(x = size.width * 0.58f, y = size.height * 0.34f),
            control2 = Offset(x = size.width * 0.92f, y = size.height * 0.16f),
            end = Offset(x = size.width * 1.18f, y = size.height * 0.32f),
            progress = reviewReactionEaseInCubic(progress = phase.exit)
        )
    }
    val radius: Float = min(size.width, size.height) * 0.12f
    val scale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0.95f + sin(progress * PI.toFloat()) * 0.08f
    } else {
        reviewReactionPopScale(
            progress = progress,
            enterEnd = 0.38f,
            exitStart = 0.76f,
            baseScale = 0.68f,
            peakScale = 1.20f,
            settledScale = 1.00f
        )
    }
    val rotationDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        -8f
    } else {
        reviewReactionInterpolate(
            start = -28f,
            end = 8f,
            progress = reviewReactionEaseOutCubic(progress = phase.enter)
        ) - phase.exit * 26f
    }

    drawScallopedSeal(
        center = center,
        radius = radius * scale,
        rotationDegrees = rotationDegrees,
        fillColor = reviewReactionRedColor,
        strokeColor = Color.White.copy(alpha = 0.90f)
    )
    drawRefreshGlyph(
        center = center,
        radius = radius * 0.54f * scale,
        rotationDegrees = rotationDegrees + 20f,
        color = Color.White
    )
}

private fun DrawScope.drawAgainWarningTape(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.34f,
        exitStart = 0.80f
    )
    val snap: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.35f)
    }
    val drift: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(phase.hold * PI.toFloat() * 2f) * 18f * (1f - phase.exit)
    }
    val exitShift: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) 0f else phase.exit * 48f
    val lengthScale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionInterpolate(start = 0.18f, end = 1f, progress = min(snap, 1f))
    }

    drawWarningTapeBand(
        center = Offset(x = size.width * 0.50f + drift + exitShift, y = size.height * 0.32f - (1f - min(snap, 1f)) * 22f),
        length = size.width * 1.30f * lengthScale,
        height = 34f,
        rotationDegrees = -13f - (1f - min(snap, 1f)) * 10f,
        alpha = 1f
    )
    drawWarningTapeBand(
        center = Offset(x = size.width * 0.50f - drift - exitShift, y = size.height * 0.58f + (1f - min(snap, 1f)) * 18f),
        length = size.width * 1.24f * lengthScale,
        height = 28f,
        rotationDegrees = 12f + (1f - min(snap, 1f)) * 8f,
        alpha = 0.82f
    )
}

private fun DrawScope.drawHardHourglassSand(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.34f,
        exitStart = 0.84f
    )
    val center: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.42f)
    val height: Float = min(size.height * 0.34f, 210f)
    val width: Float = height * 0.50f
    val wobbleDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 3.4f) * 6f * (1f - phase.exit)
    }
    val breatheScale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.94f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.20f) * 0.06f +
            sin(progress * PI.toFloat() * 4f) * 0.018f
    }

    val topLeft: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = -width * 0.50f, y = -height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )
    val topRight: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = width * 0.50f, y = -height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )
    val waist: Offset = center
    val bottomLeft: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = -width * 0.50f, y = height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )
    val bottomRight: Offset = transformLocalPoint(
        center = center,
        local = Offset(x = width * 0.50f, y = height * 0.50f),
        scale = breatheScale,
        rotationDegrees = wobbleDegrees
    )

    drawPath(
        path = polygonPath(points = listOf(topLeft, topRight, waist)),
        color = reviewReactionYellowColor.copy(alpha = 0.24f)
    )
    drawPath(
        path = polygonPath(points = listOf(waist, bottomLeft, bottomRight)),
        color = reviewReactionOrangeColor.copy(alpha = 0.28f)
    )
    drawLine(color = reviewReactionYellowColor, start = topLeft, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = topRight, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = bottomLeft, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = bottomRight, end = waist, strokeWidth = 8f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = topLeft, end = topRight, strokeWidth = 10f, cap = StrokeCap.Round)
    drawLine(color = reviewReactionYellowColor, start = bottomLeft, end = bottomRight, strokeWidth = 10f, cap = StrokeCap.Round)

    val sandDropHeight: Float = height * 0.22f * reviewReactionClampedProgress(progress = phase.enter + phase.hold * 0.35f)
    drawLine(
        color = reviewReactionOrangeColor,
        start = Offset(x = center.x, y = center.y - sandDropHeight * 0.48f),
        end = Offset(x = center.x, y = center.y + sandDropHeight),
        strokeWidth = 4f,
        cap = StrokeCap.Round
    )
    drawOval(
        color = reviewReactionOrangeColor,
        topLeft = Offset(x = center.x - width * 0.22f, y = center.y + height * 0.28f),
        size = Size(width = width * 0.44f, height = height * 0.12f)
    )
}

private fun DrawScope.drawHardFallingWeight(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.52f,
        exitStart = 0.82f
    )
    val fallProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionEaseInCubic(progress = phase.enter)
    }
    val rebound: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(phase.hold * PI.toFloat() * 2.2f) * (1f - phase.hold)
    }
    val center: Offset = Offset(
        x = size.width * 0.50f,
        y = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            size.height * 0.52f
        } else {
            reviewReactionInterpolate(start = size.height * -0.16f, end = size.height * 0.52f, progress = fallProgress) -
                rebound * 24f + phase.exit * 22f
        }
    )
    val stretch: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) 0f else (1f - phase.enter) * 0.16f
    drawWeight(
        center = center,
        width = min(size.width, size.height) * 0.36f,
        height = min(size.width, size.height) * 0.25f,
        xScale = 1f + stretch,
        yScale = 1f - stretch * 0.7f
    )
    drawImpactLines(
        center = Offset(x = center.x, y = size.height * 0.68f),
        radius = min(size.width, size.height) * 0.20f,
        progress = reviewReactionClampedProgress(progress = phase.enter + phase.hold),
        color = reviewReactionYellowColor
    )
}

private fun DrawScope.drawHardYellowCrack(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.64f,
        exitStart = 0.82f
    )
    val drawProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        min(phase.enter * 1.12f, 1f)
    }
    val impactGlow: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(min(phase.enter, 1f) * PI.toFloat())
    }
    val center: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.44f)
    drawCircle(
        color = reviewReactionYellowColor.copy(alpha = 0.22f + impactGlow * 0.20f),
        radius = min(size.width, size.height) * 0.26f,
        center = center
    )
    val points: List<Offset> = listOf(
        Offset(x = size.width * 0.46f, y = size.height * 0.22f),
        Offset(x = size.width * 0.53f, y = size.height * 0.36f),
        Offset(x = size.width * 0.47f, y = size.height * 0.46f),
        Offset(x = size.width * 0.55f, y = size.height * 0.58f),
        Offset(x = size.width * 0.49f, y = size.height * 0.76f)
    )
    drawPolylineProgress(
        points = points,
        progress = drawProgress,
        color = Color.Black.copy(alpha = 0.32f),
        strokeWidth = 17f
    )
    drawPolylineProgress(
        points = points,
        progress = drawProgress,
        color = reviewReactionYellowColor,
        strokeWidth = 10f
    )
    drawPolylineProgress(
        points = points,
        progress = drawProgress,
        color = Color.White.copy(alpha = 0.72f),
        strokeWidth = 3f
    )
    listOf(
        listOf(points[1], Offset(x = size.width * 0.34f, y = size.height * 0.33f)),
        listOf(points[2], Offset(x = size.width * 0.66f, y = size.height * 0.48f)),
        listOf(points[3], Offset(x = size.width * 0.35f, y = size.height * 0.66f))
    ).forEachIndexed { index: Int, branch: List<Offset> ->
        val branchProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            1f
        } else {
            reviewReactionClampedProgress(progress = (phase.enter - index.toFloat() * 0.18f) / 0.62f)
        }
        drawPolylineProgress(
            points = branch,
            progress = branchProgress,
            color = reviewReactionYellowColor,
            strokeWidth = 6f
        )
    }
}

private fun DrawScope.drawHardRollingBoulder(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.62f,
        exitStart = 0.82f
    )
    val baseY: Float = size.height * 0.56f
    val targetCenter: Offset = Offset(x = size.width * 0.50f, y = baseY)
    val center: Offset = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        targetCenter
    } else if (progress < 0.62f) {
        val travel: Float = reviewReactionEaseInOut(progress = phase.enter)
        val hop: Float = abs(sin(phase.enter * PI.toFloat() * 3f)) * 22f * (1f - phase.enter * 0.35f)
        Offset(
            x = reviewReactionInterpolate(start = size.width * -0.22f, end = targetCenter.x, progress = travel),
            y = baseY - hop
        )
    } else if (progress < 0.82f) {
        Offset(
            x = targetCenter.x + sin(phase.hold * PI.toFloat() * 2f) * 10f * (1f - phase.hold),
            y = baseY - abs(sin(phase.hold * PI.toFloat() * 2f)) * 9f * (1f - phase.hold)
        )
    } else {
        val exit: Float = reviewReactionEaseInCubic(progress = phase.exit)
        Offset(x = reviewReactionInterpolate(start = targetCenter.x, end = size.width * 1.20f, progress = exit), y = baseY)
    }
    val radiusScale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.92f + sin(progress * PI.toFloat() * 3.5f) * 0.05f + phase.enter * 0.08f
    }
    val radius: Float = min(size.width, size.height) * 0.14f * radiusScale
    drawDustCloud(
        center = Offset(x = center.x - radius * 0.62f, y = baseY + radius * 0.60f),
        radius = radius,
        progress = reviewReactionClampedProgress(progress = phase.enter + phase.hold * 0.4f)
    )
    drawBoulder(center = center, radius = radius, rotationDegrees = progress * 720f)
}

private fun DrawScope.drawGoodHandDrawnCheck(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.62f,
        exitStart = 0.84f
    )
    val drawProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        min(reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.15f), 1f)
    }
    val settle: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        1f + sin(phase.hold * PI.toFloat() * 2f) * 0.035f * (1f - phase.hold)
    }
    drawCheckMark(
        center = Offset(x = size.width * 0.50f, y = size.height * 0.43f),
        width = min(size.width, size.height) * 0.54f * settle,
        color = reviewReactionGreenColor,
        lineWidth = 20f,
        progress = drawProgress
    )
}

private fun DrawScope.drawGoodLightSweep(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.38f,
        exitStart = 0.78f
    )
    val centerX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        size.width * 0.50f
    } else if (progress < 0.38f) {
        reviewReactionInterpolate(start = -size.width * 0.18f, end = size.width * 0.50f, progress = reviewReactionEaseOutCubic(progress = phase.enter))
    } else if (progress < 0.78f) {
        size.width * 0.50f + sin(phase.hold * PI.toFloat() * 2f) * 18f
    } else {
        reviewReactionInterpolate(start = size.width * 0.50f, end = size.width * 1.18f, progress = reviewReactionEaseInCubic(progress = phase.exit))
    }
    val colors: List<Color> = listOf(reviewReactionYellowColor, Color.White, reviewReactionGreenColor)
    colors.forEachIndexed { index: Int, color: Color ->
        drawBeam(
            center = Offset(x = centerX + index.toFloat() * 18f - 18f, y = size.height * 0.43f),
            length = size.width * (0.88f - index.toFloat() * 0.12f),
            height = 76f - index.toFloat() * 16f,
            rotationDegrees = -9f,
            color = color.copy(alpha = 0.22f + index.toFloat() * 0.18f)
        )
    }
}

private fun DrawScope.drawGoodPaperPlaneCheck(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.46f,
        exitStart = 0.78f
    )
    val targetCenter: Offset = Offset(x = size.width * 0.56f, y = size.height * 0.38f)
    val center: Offset = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        targetCenter
    } else if (progress < 0.46f) {
        cubicBezierPoint(
            start = Offset(x = size.width * -0.22f, y = size.height * 0.72f),
            control1 = Offset(x = size.width * 0.14f, y = size.height * 0.28f),
            control2 = Offset(x = size.width * 0.38f, y = size.height * 0.18f),
            end = targetCenter,
            progress = reviewReactionEaseInOut(progress = phase.enter)
        )
    } else if (progress < 0.78f) {
        Offset(
            x = targetCenter.x + sin(phase.hold * PI.toFloat() * 2f) * 18f,
            y = targetCenter.y + sin(phase.hold * PI.toFloat() * 4f) * 8f
        )
    } else {
        cubicBezierPoint(
            start = targetCenter,
            control1 = Offset(x = size.width * 0.68f, y = size.height * 0.22f),
            control2 = Offset(x = size.width * 1.00f, y = size.height * 0.24f),
            end = Offset(x = size.width * 1.18f, y = size.height * 0.44f),
            progress = reviewReactionEaseInCubic(progress = phase.exit)
        )
    }
    val scaleMultiplier: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.82f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.20f) * 0.24f -
            phase.exit * 0.12f
    }
    val scale: Float = min(size.width, size.height) / 390f * scaleMultiplier
    val rotationDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        -10f
    } else {
        reviewReactionInterpolate(start = -30f, end = -8f, progress = phase.enter) +
            sin(progress * PI.toFloat() * 4f) * 4f - phase.exit * 12f
    }
    drawPaperPlane(center = center, scale = scale, rotationDegrees = rotationDegrees)
    drawCheckMark(
        center = Offset(x = center.x - 58f * scale, y = center.y + 48f * scale),
        width = 72f * scale,
        color = reviewReactionGreenColor,
        lineWidth = 7f * scale,
        progress = 1f
    )
}

private fun DrawScope.drawGoodCheckSealBounce(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.36f,
        exitStart = 0.82f
    )
    val bounce: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        sin(progress * PI.toFloat())
    } else {
        sin(phase.hold * PI.toFloat() * 3f) * (1f - phase.hold)
    }
    val scale: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0.96f + bounce * 0.08f
    } else {
        reviewReactionPopScale(
            progress = progress,
            enterEnd = 0.36f,
            exitStart = 0.82f,
            baseScale = 0.70f,
            peakScale = 1.18f,
            settledScale = 1.00f
        )
    }
    val center: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.42f - abs(bounce) * 16f)
    val rotationDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        -7f
    } else {
        -18f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.15f) * 13f + bounce * 7f
    }
    drawScallopedSeal(
        center = center,
        radius = min(size.width, size.height) * 0.15f * scale,
        rotationDegrees = rotationDegrees,
        fillColor = reviewReactionGreenColor,
        strokeColor = Color.White.copy(alpha = 0.88f)
    )
    drawCheckMark(
        center = center,
        width = min(size.width, size.height) * 0.17f * scale,
        color = Color.White,
        lineWidth = 9f * scale,
        progress = 1f
    )
}

private fun DrawScope.drawEasySparkleBurst(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.56f,
        exitStart = 0.84f
    )
    val centerWaveY: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 2f) * 8f * (1f - phase.exit)
    }
    val center: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.40f + centerWaveY)
    val burstProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0.65f
    } else {
        reviewReactionEaseOutCubic(progress = phase.enter)
    }
    val colors: List<Color> = listOf(
        reviewReactionYellowColor,
        reviewReactionPinkColor,
        reviewReactionBlueColor,
        reviewReactionGreenColor
    )
    for (index in 0 until 18) {
        val angle: Float = index.toFloat() / 18f * PI.toFloat() * 2f
        val localProgress: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
            0.72f
        } else {
            reviewReactionClampedProgress(progress = (phase.enter - (index % 6).toFloat() * 0.055f) / 0.76f)
        }
        val radius: Float = min(size.width, size.height) * (0.10f + 0.24f * burstProgress)
        val sparkleCenter: Offset = Offset(
            x = center.x + cos(angle) * radius * (0.72f + index.toFloat() % 3f * 0.10f),
            y = center.y + sin(angle) * radius * (0.72f + index.toFloat() % 4f * 0.06f)
        )
        drawSparkle(
            center = sparkleCenter,
            radius = (9f + (index % 4).toFloat() * 4f) * (0.70f + localProgress * 0.50f),
            color = colors[index % colors.size].copy(alpha = localProgress)
        )
    }
}

private fun DrawScope.drawEasyRainbowStreak(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.40f,
        exitStart = 0.78f
    )
    val centerX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        size.width * 0.50f
    } else if (progress < 0.40f) {
        reviewReactionInterpolate(start = -size.width * 0.24f, end = size.width * 0.50f, progress = reviewReactionEaseOutCubic(progress = phase.enter))
    } else if (progress < 0.78f) {
        size.width * 0.50f + sin(phase.hold * PI.toFloat() * 2f) * 22f
    } else {
        reviewReactionInterpolate(start = size.width * 0.50f, end = size.width * 1.24f, progress = reviewReactionEaseInCubic(progress = phase.exit))
    }
    val center: Offset = Offset(x = centerX, y = size.height * 0.42f)
    val colors: List<Color> = listOf(
        reviewReactionRedColor,
        reviewReactionOrangeColor,
        reviewReactionYellowColor,
        reviewReactionGreenColor,
        reviewReactionBlueColor,
        reviewReactionPurpleColor
    )
    colors.forEachIndexed { index: Int, color: Color ->
        val offset: Float = (index - 2).toFloat() * 11f
        drawCubicStroke(
            start = Offset(x = center.x - size.width * 0.48f, y = center.y + offset + 10f),
            control1 = Offset(x = center.x - size.width * 0.22f, y = center.y + offset - 54f - sin(progress * PI.toFloat() * 2f) * 12f),
            control2 = Offset(x = center.x + size.width * 0.20f, y = center.y + offset + 46f + sin(progress * PI.toFloat() * 2f + index.toFloat()) * 12f),
            end = Offset(x = center.x + size.width * 0.48f, y = center.y + offset - 14f),
            progress = 1f,
            color = color.copy(alpha = 0.78f),
            strokeWidth = 10f
        )
    }
}

private fun DrawScope.drawEasyCrownBounce(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.44f,
        exitStart = 0.82f
    )
    val targetCenter: Offset = Offset(x = size.width * 0.50f, y = size.height * 0.40f)
    val bounce: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        sin(progress * PI.toFloat())
    } else {
        sin(phase.hold * PI.toFloat() * 3f) * (1f - phase.hold)
    }
    val centerWaveX: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        0f
    } else {
        sin(progress * PI.toFloat() * 2f) * 6f * (1f - phase.exit)
    }
    val centerY: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        targetCenter.y
    } else {
        reviewReactionInterpolate(
            start = -min(size.width, size.height) * 0.16f,
            end = targetCenter.y,
            progress = reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.10f)
        ) - bounce * 28f + phase.exit * 18f
    }
    val center: Offset = Offset(
        x = targetCenter.x + centerWaveX,
        y = centerY
    )
    val scaleMultiplier: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        reviewReactionPopScale(
            progress = progress,
            enterEnd = 0.44f,
            exitStart = 0.82f,
            baseScale = 0.76f,
            peakScale = 1.16f,
            settledScale = 1.00f
        )
    }
    val scale: Float = min(size.width, size.height) / 360f * scaleMultiplier
    val rotationDegrees: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        -3f
    } else {
        -14f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.20f) * 18f + bounce * 4f
    }
    drawCrown(center = center, scale = scale, rotationDegrees = rotationDegrees)
    drawSparkle(
        center = Offset(x = center.x + 76f * scale + phase.hold * 16f, y = center.y - 48f * scale - abs(bounce) * 10f),
        radius = 14f * scale * (0.80f + sin(progress * PI.toFloat() * 5f) * 0.18f + phase.enter * 0.20f),
        color = reviewReactionYellowColor
    )
}

private fun DrawScope.drawEasyUnicornFlyby(
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = 0.42f,
        exitStart = 0.80f
    )
    val displayCenter: Offset = Offset(x = size.width * 0.56f, y = size.height * 0.30f)
    val center: Offset = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        displayCenter
    } else if (progress < 0.42f) {
        cubicBezierPoint(
            start = Offset(x = size.width * 1.18f, y = size.height * 0.22f),
            control1 = Offset(x = size.width * 0.92f, y = size.height * 0.08f),
            control2 = Offset(x = size.width * 0.68f, y = size.height * 0.20f),
            end = displayCenter,
            progress = reviewReactionEaseOutCubic(progress = phase.enter)
        )
    } else if (progress < 0.80f) {
        Offset(
            x = displayCenter.x + sin(phase.hold * PI.toFloat() * 2f) * 20f,
            y = displayCenter.y + sin(phase.hold * PI.toFloat() * 4f) * 14f
        )
    } else {
        cubicBezierPoint(
            start = displayCenter,
            control1 = Offset(x = size.width * 0.36f, y = size.height * 0.16f),
            control2 = Offset(x = size.width * 0.08f, y = size.height * 0.12f),
            end = Offset(x = size.width * -0.24f, y = size.height * 0.28f),
            progress = reviewReactionEaseInCubic(progress = phase.exit)
        )
    }
    val scaleMultiplier: Float = if (motionMode == ReviewReactionMotionMode.REDUCED) {
        1f
    } else {
        0.84f + reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.18f) * 0.20f -
            phase.exit * 0.12f
    }
    val scale: Float = min(size.width, size.height) / 410f * scaleMultiplier
    drawRainbowTrail(
        center = Offset(x = center.x + 20f * scale, y = center.y + 26f * scale),
        length = min(size.width, size.height) * 0.42f,
        scale = scale,
        progress = if (motionMode == ReviewReactionMotionMode.REDUCED) 0.70f else phase.enter + phase.hold * 0.30f
    )
    drawUnicorn(center = center, scale = scale, rotationDegrees = -8f + sin(progress * PI.toFloat() * 4f) * 4f)
}

private fun DrawScope.drawWarningTapeBand(
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

private fun DrawScope.drawWeight(
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

private fun DrawScope.drawImpactLines(
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

private fun DrawScope.drawBoulder(
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

private fun DrawScope.drawDustCloud(
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

private fun DrawScope.drawCheckMark(
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

private fun DrawScope.drawBeam(
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

private fun DrawScope.drawPaperPlane(
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

private fun DrawScope.drawScallopedSeal(
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

private fun DrawScope.drawSparkle(
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

private fun DrawScope.drawCrown(
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

private fun DrawScope.drawRainbowTrail(
    center: Offset,
    length: Float,
    scale: Float,
    progress: Float
) {
    val colors: List<Color> = listOf(
        reviewReactionRedColor,
        reviewReactionOrangeColor,
        reviewReactionYellowColor,
        reviewReactionGreenColor,
        reviewReactionBlueColor,
        reviewReactionPurpleColor
    )
    colors.forEachIndexed { index: Int, color: Color ->
        val offset: Float = (index - 2).toFloat() * 7f * scale
        drawCubicStroke(
            start = Offset(x = center.x + length * 0.42f, y = center.y + offset),
            control1 = Offset(x = center.x + length * 0.12f, y = center.y + offset - 28f * scale),
            control2 = Offset(x = center.x - length * 0.24f, y = center.y + offset + 28f * scale),
            end = Offset(x = center.x - length * 0.54f * reviewReactionClampedProgress(progress = progress), y = center.y + offset),
            progress = 1f,
            color = color.copy(alpha = 0.70f),
            strokeWidth = 7f * scale
        )
    }
}

private fun DrawScope.drawUnicorn(
    center: Offset,
    scale: Float,
    rotationDegrees: Float
) {
    val bodyCenter: Offset = transformLocalPoint(center = center, local = Offset(x = -20f, y = 18f), scale = scale, rotationDegrees = rotationDegrees)
    val headCenter: Offset = transformLocalPoint(center = center, local = Offset(x = 56f, y = -18f), scale = scale, rotationDegrees = rotationDegrees)
    drawOval(
        color = Color.White,
        topLeft = Offset(x = bodyCenter.x - 66f * scale, y = bodyCenter.y - 34f * scale),
        size = Size(width = 112f * scale, height = 58f * scale)
    )
    drawCircle(color = Color.White, radius = 34f * scale, center = headCenter)
    drawOval(
        color = reviewReactionPurpleColor.copy(alpha = 0.48f),
        topLeft = Offset(x = bodyCenter.x - 66f * scale, y = bodyCenter.y - 34f * scale),
        size = Size(width = 112f * scale, height = 58f * scale),
        style = Stroke(width = 4f * scale)
    )
    val hornPoints: List<Offset> = listOf(
        Offset(x = 70f, y = -54f),
        Offset(x = 92f, y = -100f),
        Offset(x = 98f, y = -42f)
    ).map { local: Offset ->
        transformLocalPoint(center = center, local = local, scale = scale, rotationDegrees = rotationDegrees)
    }
    drawPath(path = polygonPath(points = hornPoints), color = reviewReactionYellowColor)
    drawPath(
        path = polygonPath(points = hornPoints),
        color = reviewReactionOrangeColor,
        style = Stroke(width = 3f * scale, join = StrokeJoin.Round)
    )
    val maneColors: List<Color> = listOf(reviewReactionPinkColor, reviewReactionBlueColor, reviewReactionPurpleColor)
    maneColors.forEachIndexed { index: Int, color: Color ->
        val x: Float = 38f - index.toFloat() * 16f
        val maneStart: Offset = transformLocalPoint(center = center, local = Offset(x = x, y = -44f), scale = scale, rotationDegrees = rotationDegrees)
        val maneEnd: Offset = transformLocalPoint(center = center, local = Offset(x = x - 18f, y = -6f), scale = scale, rotationDegrees = rotationDegrees)
        drawLine(color = color, start = maneStart, end = maneEnd, strokeWidth = 7f * scale, cap = StrokeCap.Round)
    }
    val eyeCenter: Offset = transformLocalPoint(center = center, local = Offset(x = 72f, y = -22f), scale = scale, rotationDegrees = rotationDegrees)
    drawCircle(color = Color.Black.copy(alpha = 0.76f), radius = 4f * scale, center = eyeCenter)
}

private fun DrawScope.drawRefreshGlyph(
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

private fun DrawScope.drawArrowTriangle(
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

private fun DrawScope.drawCubicStroke(
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

private fun DrawScope.drawSpiralStroke(
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

private fun DrawScope.drawPolylineProgress(
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

private fun polygonPath(points: List<Offset>): Path {
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

private fun makeScallopedSealPath(
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

private fun transformLocalPoint(
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

private fun cubicBezierPoint(
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

private fun reviewReactionPhaseProgress(
    progress: Float,
    enterEnd: Float,
    exitStart: Float
): ReviewReactionPhaseProgress {
    require(enterEnd > 0f) {
        "Review reaction enter phase must be positive."
    }
    require(exitStart > enterEnd) {
        "Review reaction exit phase must start after enter phase."
    }
    require(exitStart < 1f) {
        "Review reaction exit phase must start before progress completes."
    }

    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    return ReviewReactionPhaseProgress(
        enter = reviewReactionClampedProgress(progress = clampedProgress / enterEnd),
        hold = reviewReactionClampedProgress(progress = (clampedProgress - enterEnd) / (exitStart - enterEnd)),
        exit = reviewReactionClampedProgress(progress = (clampedProgress - exitStart) / (1f - exitStart))
    )
}

private fun reviewReactionPopScale(
    progress: Float,
    enterEnd: Float,
    exitStart: Float,
    baseScale: Float,
    peakScale: Float,
    settledScale: Float
): Float {
    val phase: ReviewReactionPhaseProgress = reviewReactionPhaseProgress(
        progress = progress,
        enterEnd = enterEnd,
        exitStart = exitStart
    )
    if (phase.enter < 1f) {
        val scale: Float = reviewReactionInterpolate(
            start = baseScale,
            end = peakScale,
            progress = reviewReactionEaseOutBack(progress = phase.enter, overshoot = 1.22f)
        )
        return min(scale, peakScale)
    }
    if (phase.exit > 0f) {
        return reviewReactionInterpolate(
            start = settledScale,
            end = baseScale,
            progress = reviewReactionEaseInCubic(progress = phase.exit)
        )
    }

    val settlePulse: Float = sin(phase.hold * PI.toFloat() * 4f) * 0.045f * (1f - phase.hold)
    return settledScale + settlePulse
}

private fun reviewReactionClampedProgress(progress: Float): Float {
    return min(max(progress, 0f), 1f)
}

private fun reviewReactionInterpolate(
    start: Float,
    end: Float,
    progress: Float
): Float {
    return start + (end - start) * reviewReactionClampedProgress(progress = progress)
}

private fun reviewReactionEaseOutCubic(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    val inverseProgress: Float = 1f - clampedProgress
    return 1f - inverseProgress * inverseProgress * inverseProgress
}

private fun reviewReactionEaseInCubic(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    return clampedProgress * clampedProgress * clampedProgress
}

private fun reviewReactionEaseInOut(progress: Float): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    if (clampedProgress < 0.5f) {
        return 4f * clampedProgress * clampedProgress * clampedProgress
    }

    val shiftedProgress: Float = -2f * clampedProgress + 2f
    return 1f - shiftedProgress * shiftedProgress * shiftedProgress / 2f
}

private fun reviewReactionEaseOutBack(
    progress: Float,
    overshoot: Float
): Float {
    val clampedProgress: Float = reviewReactionClampedProgress(progress = progress)
    val shiftedProgress: Float = clampedProgress - 1f
    return 1f + (overshoot + 1f) * shiftedProgress * shiftedProgress * shiftedProgress +
        overshoot * shiftedProgress * shiftedProgress
}

private fun degreesToRadians(degrees: Float): Float {
    return degrees / 180f * PI.toFloat()
}
