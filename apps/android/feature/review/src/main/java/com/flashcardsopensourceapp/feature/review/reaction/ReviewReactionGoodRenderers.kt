package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sin

internal fun DrawScope.drawGoodReviewReaction(
    variant: ReviewReactionVariant,
    progress: Float,
    motionMode: ReviewReactionMotionMode
) {
    when (variant) {
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

        else -> error("Unsupported good review reaction variant: $variant")
    }
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
