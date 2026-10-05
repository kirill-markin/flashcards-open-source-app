package com.flashcardsopensourceapp.feature.review.reaction

import android.animation.ValueAnimator
import androidx.annotation.RawRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.compose.LottieCompositionResult
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.rememberLottieComposition
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidReviewReactionDiagnostic
import com.flashcardsopensourceapp.core.observability.AndroidReviewReactionSource
import com.flashcardsopensourceapp.core.observability.AndroidReviewReactionStage
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.feature.review.R
import kotlinx.coroutines.CancellationException

class ReviewReactionLottieConfigurationStore internal constructor(
    internal val configurations: Map<ReviewReactionVariant, ReviewReactionLottieConfiguration>,
    private val observability: AppObservability,
    private val source: AndroidReviewReactionSource
) {
    internal var isPowerSaveMode: Boolean = false
    private val reportedFailures: MutableSet<ReviewReactionVariant> = mutableSetOf()
    private val recordedStages: MutableSet<AndroidReviewReactionStage> = mutableSetOf()

    internal fun updateReadiness(variant: ReviewReactionVariant, readiness: ReviewReactionLottieReadiness) {
        val configuration = configurations[variant]
        if (configuration == null) {
            fail(
                variant = variant,
                stage = AndroidReviewReactionStage.CONFIGURATION_MISSING,
                error = IllegalStateException("Review reaction configuration is missing: ${variant.debugIdentifier}")
            )
            return
        }
        // A presentation failure stays disabled even while the composition loader recomposes.
        if (configuration.readiness !is ReviewReactionLottieReadiness.Failed) {
            configuration.readiness = readiness
        }
    }

    internal fun fail(variant: ReviewReactionVariant, stage: AndroidReviewReactionStage, error: Throwable) {
        if (error is Error) throw error
        if (error is CancellationException) {
            record(stage = AndroidReviewReactionStage.CANCELLED, variant = variant)
            return
        }
        val diagnostic = diagnostic(stage = stage, variant = variant)
        configurations[variant]?.readiness = ReviewReactionLottieReadiness.Failed(error = error)
        if (reportedFailures.add(variant)) {
            observability.captureException(
                event = AndroidExceptionIssueEvent.ReviewReactionFailure(throwable = error, diagnostic = diagnostic)
            )
        }
    }

    internal fun record(stage: AndroidReviewReactionStage, variant: ReviewReactionVariant?) {
        // Keep ordinary lifecycle evidence bounded independently of review and frame counts.
        if (recordedStages.add(stage)) {
            observability.addBreadcrumb(
                event = AndroidBreadcrumbEvent.ReviewReactionLifecycle(diagnostic = diagnostic(stage, variant))
            )
        }
    }

    private fun diagnostic(
        stage: AndroidReviewReactionStage,
        variant: ReviewReactionVariant?
    ): AndroidReviewReactionDiagnostic {
        val readiness = variant?.let { configurations[it]?.readiness }
        val states = configurations.values.map { it.readiness }
        return AndroidReviewReactionDiagnostic(
            source = source,
            stage = stage,
            variant = variant?.debugIdentifier,
            asset = reviewReactionLottieAssetConfigurations.firstOrNull { it.variant == variant }?.assetName,
            readiness = when (readiness) {
                is ReviewReactionLottieReadiness.Ready -> "ready"
                is ReviewReactionLottieReadiness.Failed -> "failed"
                ReviewReactionLottieReadiness.Pending -> "pending"
                null -> "missing"
            },
            readyCount = states.count { it is ReviewReactionLottieReadiness.Ready },
            pendingCount = states.count { it is ReviewReactionLottieReadiness.Pending },
            failedCount = states.count { it is ReviewReactionLottieReadiness.Failed },
            isPowerSaveMode = isPowerSaveMode,
            areAnimatorsEnabled = ValueAnimator.areAnimatorsEnabled()
        )
    }
}

internal sealed interface ReviewReactionLottieReadiness {
    data class Ready(
        val composition: LottieComposition
    ) : ReviewReactionLottieReadiness

    data object Pending : ReviewReactionLottieReadiness

    data class Failed(
        val error: Throwable
    ) : ReviewReactionLottieReadiness
}

internal class ReviewReactionLottieConfiguration(
    initialReadiness: ReviewReactionLottieReadiness,
    val frameScale: Float
) {
    var readiness: ReviewReactionLottieReadiness by mutableStateOf(value = initialReadiness)
        internal set
}

private data class ReviewReactionLottieAssetConfiguration(
    val variant: ReviewReactionVariant,
    @RawRes val rawResourceId: Int,
    val assetName: String,
    val frameScale: Float
)

private val reviewReactionLottieAssetConfigurations: List<ReviewReactionLottieAssetConfiguration> = listOf(
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_RAIN_CLOUD,
        rawResourceId = R.raw.review_again_rain_cloud,
        assetName = "review_again_rain_cloud",
        frameScale = 0.62f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_TORNADO,
        rawResourceId = R.raw.review_again_tornado,
        assetName = "review_again_tornado",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_WIND_FACE,
        rawResourceId = R.raw.review_again_wind_face,
        assetName = "review_again_wind_face",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_SNOWFLAKE,
        rawResourceId = R.raw.review_again_snowflake,
        assetName = "review_again_snowflake",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_SNAIL_CRAWL,
        rawResourceId = R.raw.review_again_snail,
        assetName = "review_again_snail",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_TURTLE,
        rawResourceId = R.raw.review_again_turtle,
        assetName = "review_again_turtle",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_WILTED_FLOWER,
        rawResourceId = R.raw.review_again_wilted_flower,
        assetName = "review_again_wilted_flower",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_SPIDER,
        rawResourceId = R.raw.review_again_spider,
        assetName = "review_again_spider",
        frameScale = 0.54f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_RAT,
        rawResourceId = R.raw.review_again_rat,
        assetName = "review_again_rat",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.AGAIN_WORM_WIGGLE,
        rawResourceId = R.raw.review_again_worm,
        assetName = "review_again_worm",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_TIGER,
        rawResourceId = R.raw.review_hard_tiger,
        assetName = "review_hard_tiger",
        frameScale = 0.62f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_T_REX,
        rawResourceId = R.raw.review_hard_t_rex,
        assetName = "review_hard_t_rex",
        frameScale = 0.62f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_SHARK,
        rawResourceId = R.raw.review_hard_shark,
        assetName = "review_hard_shark",
        frameScale = 0.62f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_OX_CHARGE,
        rawResourceId = R.raw.review_hard_ox,
        assetName = "review_hard_ox",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_RACEHORSE_GALLOP,
        rawResourceId = R.raw.review_hard_racehorse,
        assetName = "review_hard_racehorse",
        frameScale = 0.62f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_SNAKE,
        rawResourceId = R.raw.review_hard_snake,
        assetName = "review_hard_snake",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_VOLCANO_ERUPTION,
        rawResourceId = R.raw.review_hard_volcano,
        assetName = "review_hard_volcano",
        frameScale = 0.64f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_SCORPION,
        rawResourceId = R.raw.review_hard_scorpion,
        assetName = "review_hard_scorpion",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_PAW_PRINTS,
        rawResourceId = R.raw.review_hard_paw_prints,
        assetName = "review_hard_paw_prints",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.HARD_ROOSTER,
        rawResourceId = R.raw.review_hard_rooster,
        assetName = "review_hard_rooster",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_OTTER,
        rawResourceId = R.raw.review_good_otter,
        assetName = "review_good_otter",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_OWL,
        rawResourceId = R.raw.review_good_owl,
        assetName = "review_good_owl",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_RABBIT,
        rawResourceId = R.raw.review_good_rabbit,
        assetName = "review_good_rabbit",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_SEAL,
        rawResourceId = R.raw.review_good_seal,
        assetName = "review_good_seal",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_SERVICE_DOG,
        rawResourceId = R.raw.review_good_service_dog,
        assetName = "review_good_service_dog",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_POODLE,
        rawResourceId = R.raw.review_good_poodle,
        assetName = "review_good_poodle",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_CHIMPANZEE,
        rawResourceId = R.raw.review_good_chimpanzee,
        assetName = "review_good_chimpanzee",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_WHALE,
        rawResourceId = R.raw.review_good_whale,
        assetName = "review_good_whale",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_PEACOCK,
        rawResourceId = R.raw.review_good_peacock,
        assetName = "review_good_peacock",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.GOOD_PIG,
        rawResourceId = R.raw.review_good_pig,
        assetName = "review_good_pig",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_SUNRISE,
        rawResourceId = R.raw.review_easy_sunrise,
        assetName = "review_easy_sunrise",
        frameScale = 0.64f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_SUNRISE_OVER_MOUNTAINS,
        rawResourceId = R.raw.review_easy_sunrise_over_mountains,
        assetName = "review_easy_sunrise_over_mountains",
        frameScale = 0.64f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_ROSE_BLOOM,
        rawResourceId = R.raw.review_easy_rose,
        assetName = "review_easy_rose",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_PEACE,
        rawResourceId = R.raw.review_easy_peace,
        assetName = "review_easy_peace",
        frameScale = 0.56f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_PLANT,
        rawResourceId = R.raw.review_easy_plant,
        assetName = "review_easy_plant",
        frameScale = 0.58f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_RAINBOW_STREAK,
        rawResourceId = R.raw.review_easy_rainbow,
        assetName = "review_easy_rainbow",
        frameScale = 0.64f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_PHOENIX_RISE,
        rawResourceId = R.raw.review_easy_phoenix,
        assetName = "review_easy_phoenix",
        frameScale = 0.64f
    ),
    ReviewReactionLottieAssetConfiguration(
        variant = ReviewReactionVariant.EASY_UNICORN_FLYBY,
        rawResourceId = R.raw.review_easy_unicorn,
        assetName = "review_easy_unicorn",
        frameScale = 0.52f
    )
)

@Composable
fun rememberReviewReactionLottieConfigurationStore(
    loadLottieCompositions: Boolean,
    isPowerSaveMode: Boolean,
    source: AndroidReviewReactionSource,
    observability: AppObservability
): ReviewReactionLottieConfigurationStore {
    val configurationStore: ReviewReactionLottieConfigurationStore =
        remember(observability, source) {
            createReviewReactionLottieConfigurationStore(observability = observability, source = source)
        }
    SideEffect { configurationStore.isPowerSaveMode = isPowerSaveMode }
    LaunchedEffect(loadLottieCompositions) {
        if (loadLottieCompositions.not()) {
            configurationStore.record(stage = AndroidReviewReactionStage.DISABLED, variant = null)
        }
    }

    if (loadLottieCompositions) {
        reviewReactionLottieAssetConfigurations.forEach { assetConfiguration: ReviewReactionLottieAssetConfiguration ->
            key(assetConfiguration.variant) {
                val readiness = rememberReviewReactionLottieReadiness(
                    assetConfiguration = assetConfiguration,
                    configurationStore = configurationStore
                )
                SideEffect {
                    configurationStore.updateReadiness(variant = assetConfiguration.variant, readiness = readiness)
                }
            }
        }
    }

    return configurationStore
}

private fun createReviewReactionLottieConfigurationStore(
    observability: AppObservability,
    source: AndroidReviewReactionSource
): ReviewReactionLottieConfigurationStore {
    val configurations: Map<ReviewReactionVariant, ReviewReactionLottieConfiguration> =
        reviewReactionLottieAssetConfigurations.associate { assetConfiguration: ReviewReactionLottieAssetConfiguration ->
            assetConfiguration.variant to ReviewReactionLottieConfiguration(
                initialReadiness = ReviewReactionLottieReadiness.Pending,
                frameScale = assetConfiguration.frameScale
            )
        }

    return ReviewReactionLottieConfigurationStore(configurations = configurations, observability = observability, source = source)
}

@Composable
private fun rememberReviewReactionLottieReadiness(
    assetConfiguration: ReviewReactionLottieAssetConfiguration,
    configurationStore: ReviewReactionLottieConfigurationStore
): ReviewReactionLottieReadiness {
    val compositionResult: LottieCompositionResult = rememberLottieComposition(
        spec = LottieCompositionSpec.RawRes(assetConfiguration.rawResourceId)
    )
    val composition: LottieComposition? = compositionResult.value
    if (composition != null) {
        return ReviewReactionLottieReadiness.Ready(composition = composition)
    }

    val compositionFailure: Throwable? = compositionResult.error
    if (compositionFailure != null) {
        LaunchedEffect(assetConfiguration.assetName, compositionFailure) {
            configurationStore.fail(
                variant = assetConfiguration.variant,
                stage = AndroidReviewReactionStage.LOAD_FAILED,
                error = compositionFailure
            )
        }
        if (compositionFailure is Error) throw compositionFailure
        if (compositionFailure is CancellationException) return ReviewReactionLottieReadiness.Pending
        return ReviewReactionLottieReadiness.Failed(error = compositionFailure)
    }

    return ReviewReactionLottieReadiness.Pending
}

internal fun reviewReactionLottieConfiguration(
    variant: ReviewReactionVariant,
    configurationStore: ReviewReactionLottieConfigurationStore
): ReviewReactionLottieConfiguration? {
    return configurationStore.configurations[variant]
}

internal fun reviewReactionReadyVariants(
    rating: ReviewRating,
    configurationStore: ReviewReactionLottieConfigurationStore
): Set<ReviewReactionVariant> {
    return reviewReactionVariantDistributionEntries(rating = rating)
        .mapNotNull { entry: ReviewReactionVariantDistributionEntry ->
            val readiness: ReviewReactionLottieReadiness? =
                configurationStore.configurations[entry.variant]?.readiness
            if (readiness is ReviewReactionLottieReadiness.Ready) {
                entry.variant
            } else {
                null
            }
        }
        .toSet()
}

