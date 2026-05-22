package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionResult
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.rememberLottieComposition
import com.flashcardsopensourceapp.feature.review.R
import kotlinx.coroutines.delay

private const val reviewReactionAnimationMinimumProgress: Float = 0f
private const val reviewReactionAnimationMaximumProgress: Float = 1f
private const val reviewReactionCleanupExtraMillis: Long = 80L
private const val reviewReactionReducedMotionDrawingProgress: Float = 0.55f
private const val reviewEasyUnicornAnimationFrameScale: Float = 0.52f
private const val reviewEasyUnicornAnimationCenterX: Float = 0.56f
private const val reviewEasyUnicornAnimationCenterY: Float = 0.30f
private val reviewReactionExpensiveAnimationFallbackVariant: ReviewReactionVariant =
    ReviewReactionVariant.EASY_CROWN_BOUNCE

private enum class ReviewEasyUnicornRenderer {
    CANVAS,
    LOTTIE
}

@Composable
internal fun ReviewReactionOverlay(
    modifier: Modifier,
    events: List<ReviewReactionEvent>,
    motionMode: ReviewReactionMotionMode,
    onEventFinished: (String) -> Unit
) {
    val reviewEasyUnicornCompositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(R.raw.review_easy_unicorn)
    )
    val reviewEasyUnicornCompositionFailure: Throwable? = reviewEasyUnicornCompositionResult.error
    if (reviewEasyUnicornCompositionFailure != null) {
        throw IllegalStateException(
            "Review easy unicorn Lottie asset failed to load.",
            reviewEasyUnicornCompositionFailure
        )
    }
    val reviewEasyUnicornComposition: LottieComposition? = reviewEasyUnicornCompositionResult.value

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
                    reviewEasyUnicornComposition = reviewEasyUnicornComposition,
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
    reviewEasyUnicornComposition: LottieComposition?,
    onEventFinished: (String) -> Unit
) {
    if (event.variant == ReviewReactionVariant.EASY_UNICORN_FLYBY) {
        val reviewEasyUnicornRenderer: ReviewEasyUnicornRenderer = remember(event.id) {
            if (reviewEasyUnicornComposition == null) {
                ReviewEasyUnicornRenderer.CANVAS
            } else {
                ReviewEasyUnicornRenderer.LOTTIE
            }
        }

        if (reviewEasyUnicornRenderer == ReviewEasyUnicornRenderer.LOTTIE) {
            val composition: LottieComposition = reviewEasyUnicornComposition ?: return
            ReviewReactionLottieAnimation(
                event = event,
                motionMode = motionMode,
                composition = composition,
                onEventFinished = onEventFinished
            )
            return
        }
    }

    val drawingEvent: ReviewReactionEvent = if (event.variant == ReviewReactionVariant.EASY_UNICORN_FLYBY) {
        event.copy(variant = reviewReactionExpensiveAnimationFallbackVariant)
    } else {
        event
    }
    val durationMillis: Int = reviewReactionAnimationDurationMillis(
        variant = drawingEvent.variant,
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
                event = drawingEvent,
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
            event = drawingEvent,
            progress = drawingProgress,
            motionMode = motionMode
        )
    }
}

@Composable
private fun ReviewReactionLottieAnimation(
    event: ReviewReactionEvent,
    motionMode: ReviewReactionMotionMode,
    composition: LottieComposition,
    onEventFinished: (String) -> Unit
) {
    val durationMillis: Int = reviewReactionAnimationDurationMillis(
        variant = event.variant,
        motionMode = motionMode
    )

    if (motionMode == ReviewReactionMotionMode.REDUCED) {
        LaunchedEffect(event.id, composition) {
            delay(timeMillis = durationMillis.toLong())
            onEventFinished(event.id)
        }

        ReviewReactionLottieFrame(
            progress = reviewReactionReducedMotionDrawingProgress,
            alpha = 1f,
            composition = composition
        )
        return
    }

    val progress: Animatable<Float, AnimationVector1D> = remember(event.id, composition) {
        Animatable(initialValue = reviewReactionAnimationMinimumProgress)
    }

    LaunchedEffect(event.id, composition) {
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

    ReviewReactionLottieFrame(
        progress = drawingProgress,
        alpha = alpha,
        composition = composition
    )
}

@Composable
private fun ReviewReactionLottieFrame(
    progress: Float,
    alpha: Float,
    composition: LottieComposition
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.alpha = alpha
            }
    ) {
        val sideLength: Dp = minOf(maxWidth, maxHeight) * reviewEasyUnicornAnimationFrameScale
        LottieAnimation(
            composition = composition,
            progress = { progress },
            modifier = Modifier
                .size(size = sideLength)
                .offset(
                    x = maxWidth * reviewEasyUnicornAnimationCenterX - sideLength / 2f,
                    y = maxHeight * reviewEasyUnicornAnimationCenterY - sideLength / 2f
                )
                .align(alignment = Alignment.TopStart)
        )
    }
}
