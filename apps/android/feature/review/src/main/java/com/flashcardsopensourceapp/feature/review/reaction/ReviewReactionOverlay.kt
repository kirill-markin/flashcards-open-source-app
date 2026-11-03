package com.flashcardsopensourceapp.feature.review.reaction

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.airbnb.lottie.AsyncUpdates
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.compose.LottieAnimation
import com.flashcardsopensourceapp.core.observability.AndroidReviewReactionStage
import com.flashcardsopensourceapp.feature.review.reaction.drawing.reviewReactionCenterX
import com.flashcardsopensourceapp.feature.review.reaction.drawing.reviewReactionCenterY
import com.flashcardsopensourceapp.feature.review.reaction.drawing.reviewReactionClampedProgress
import com.flashcardsopensourceapp.feature.review.reaction.drawing.reviewReactionOpacity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

private const val reviewReactionCleanupExtraMillis: Long = 80L
private const val reviewReactionReducedMotionDrawingProgress: Float = 0.55f

@Composable
internal fun ReviewReactionOverlay(
    modifier: Modifier,
    slots: List<ReviewReactionSlot>,
    isPlaybackStartAllowed: Boolean,
    motionMode: ReviewReactionMotionMode,
    configurationStore: ReviewReactionLottieConfigurationStore,
    onEventFinished: (String) -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val playingEvent by rememberUpdatedState(
        newValue = slots.firstOrNull { slot -> slot.phase == ReviewReactionSlotPhase.PLAYING }?.event
    )
    val finishEvent by rememberUpdatedState(newValue = onEventFinished)
    DisposableEffect(lifecycleOwner, configurationStore) {
        val observer = LifecycleEventObserver { _, lifecycleEvent ->
            if (lifecycleEvent == Lifecycle.Event.ON_STOP) {
                playingEvent?.let { event ->
                    configurationStore.record(stage = AndroidReviewReactionStage.LIFECYCLE_STOPPED, variant = event.variant)
                    finishEvent(event.id)
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            playingEvent?.let { event ->
                configurationStore.record(stage = AndroidReviewReactionStage.CANCELLED, variant = event.variant)
            }
        }
    }
    Box(modifier = modifier.fillMaxSize().clearAndSetSemantics {}) {
        slots.forEach { slot ->
            key(slot.event.id) {
                ReviewReactionCanvas(slot, isPlaybackStartAllowed, motionMode, configurationStore, onEventFinished)
            }
        }
    }
}

@Composable
private fun ReviewReactionCanvas(
    slot: ReviewReactionSlot,
    isPlaybackStartAllowed: Boolean,
    motionMode: ReviewReactionMotionMode,
    configurationStore: ReviewReactionLottieConfigurationStore,
    onEventFinished: (String) -> Unit
) {
    val event = slot.event
    val configuration = reviewReactionLottieConfiguration(variant = event.variant, configurationStore = configurationStore)
    val readiness = configuration?.readiness
    if (readiness !is ReviewReactionLottieReadiness.Ready) {
        LaunchedEffect(event.id, readiness) {
            when (readiness) {
                null -> configurationStore.fail(
                    variant = event.variant,
                    stage = AndroidReviewReactionStage.CONFIGURATION_MISSING,
                    error = IllegalStateException("Review reaction configuration is missing: ${event.variant.debugIdentifier}")
                )
                ReviewReactionLottieReadiness.Pending -> configurationStore.record(
                    stage = AndroidReviewReactionStage.PENDING_SKIPPED, variant = event.variant
                )
                is ReviewReactionLottieReadiness.Failed -> Unit
                is ReviewReactionLottieReadiness.Ready -> Unit
            }
            onEventFinished(event.id)
        }
        return
    }
    val composition = readiness.composition
    if (composition.duration <= 0f || !composition.duration.isFinite()
        || composition.bounds.width() <= 0 || composition.bounds.height() <= 0
        || !configuration.frameScale.isFinite() || configuration.frameScale <= 0f || configuration.frameScale > 1f
    ) {
        LaunchedEffect(event.id) {
            configurationStore.fail(
                variant = event.variant,
                stage = AndroidReviewReactionStage.PRESENTATION_FAILED,
                error = IllegalArgumentException("Review reaction has invalid bounds, duration, or frame scale: ${event.variant.debugIdentifier}")
            )
            onEventFinished(event.id)
        }
        return
    }
    val finishEvent by rememberUpdatedState(newValue = onEventFinished)
    val currentIsPlaybackStartAllowed by rememberUpdatedState(newValue = isPlaybackStartAllowed)
    val isPlaying = slot.phase == ReviewReactionSlotPhase.PLAYING
    val progress = remember(event.id, composition) { Animatable(initialValue = 0f) }
    var isPlaybackStarted by remember(event.id) { mutableStateOf(false) }
    val durationMillis = reviewReactionAnimationDurationMillis(variant = event.variant, motionMode = motionMode)
    LaunchedEffect(event.id, composition, motionMode, isPlaying) {
        if (isPlaying.not()) {
            return@LaunchedEffect
        }
        // The frame that first draws the next card must not also start the reaction.
        snapshotFlow { currentIsPlaybackStartAllowed }.first { isAllowed -> isAllowed }
        withFrameNanos { }
        try {
            isPlaybackStarted = true
            configurationStore.record(stage = AndroidReviewReactionStage.STARTED, variant = event.variant)
            if (motionMode == ReviewReactionMotionMode.REDUCED) {
                delay(timeMillis = durationMillis.toLong())
            } else {
                progress.animateTo(targetValue = 1f, animationSpec = tween(durationMillis = durationMillis, easing = LinearEasing))
                delay(timeMillis = reviewReactionCleanupExtraMillis)
            }
            configurationStore.record(stage = AndroidReviewReactionStage.COMPLETED, variant = event.variant)
            finishEvent(event.id)
        } catch (error: CancellationException) {
            configurationStore.record(stage = AndroidReviewReactionStage.CANCELLED, variant = event.variant)
            throw error
        } catch (error: Exception) {
            configurationStore.fail(variant = event.variant, stage = AndroidReviewReactionStage.PRESENTATION_FAILED, error = error)
            finishEvent(event.id)
        }
    }
    val reducedMotion = motionMode == ReviewReactionMotionMode.REDUCED
    // Hidden slots still record their draw at alpha 0, so the drawable is built and drawn before the tap.
    ReviewReactionLottieFrame(
        progress = if (reducedMotion) reviewReactionReducedMotionDrawingProgress else reviewReactionClampedProgress(progress.value),
        alpha = when {
            isPlaying.not() || isPlaybackStarted.not() -> 0f
            reducedMotion -> 1f
            else -> reviewReactionOpacity(progress.value)
        },
        frameScale = configuration.frameScale,
        composition = composition,
        onPresentationFailure = { error ->
            configurationStore.fail(variant = event.variant, stage = AndroidReviewReactionStage.PRESENTATION_FAILED, error = error)
            finishEvent(event.id)
        }
    )
}

@Composable
private fun ReviewReactionLottieFrame(
    progress: Float,
    alpha: Float,
    frameScale: Float,
    composition: LottieComposition,
    onPresentationFailure: (Exception) -> Unit
) {
    var presentationFailure: Exception? by remember(composition) { mutableStateOf(null) }
    val reportFailure by rememberUpdatedState(newValue = onPresentationFailure)
    BoxWithConstraints(modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha }) {
        val sideLength: Dp = minOf(maxWidth, maxHeight) * frameScale
        LottieAnimation(
            composition = composition,
            progress = { progress },
            enableMergePaths = true,
            // Keep progress/configuration failures synchronous with this Canvas boundary.
            asyncUpdates = AsyncUpdates.DISABLED,
            safeMode = false,
            modifier = Modifier
                .size(size = sideLength)
                .offset(
                    x = maxWidth * reviewReactionCenterX - sideLength / 2f,
                    y = maxHeight * reviewReactionCenterY - sideLength / 2f
                )
                .align(alignment = Alignment.TopStart)
                .drawWithContent {
                    if (presentationFailure == null) {
                        val canvas = drawContext.canvas.nativeCanvas
                        val saveCount = canvas.save()
                        try {
                            drawContent()
                        } catch (error: CancellationException) {
                            presentationFailure = error
                            reportFailure(error)
                        } catch (error: Exception) {
                            // Disable before reporting so another draw cannot repeat the failure.
                            presentationFailure = error
                            reportFailure(error)
                        } finally {
                            canvas.restoreToCount(saveCount)
                        }
                    }
                }
        )
    }
}
