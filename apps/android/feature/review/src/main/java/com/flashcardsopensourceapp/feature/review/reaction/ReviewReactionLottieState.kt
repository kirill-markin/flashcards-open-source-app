package com.flashcardsopensourceapp.feature.review.reaction

import android.util.Log
import androidx.annotation.RawRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.airbnb.lottie.LottieComposition
import com.airbnb.lottie.compose.LottieCompositionResult
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.rememberLottieComposition
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.feature.review.R

private const val reviewReactionLogTag: String = "ReviewReaction"

internal val reviewReactionLottieFallbackVariant: ReviewReactionVariant =
    ReviewReactionVariant.FALLBACK_CROWN_BOUNCE

class ReviewReactionLottieConfigurationStore internal constructor(
    internal val configurations: Map<ReviewReactionVariant, ReviewReactionLottieConfiguration>
) {
    internal fun updateReadiness(
        variant: ReviewReactionVariant,
        readiness: ReviewReactionLottieReadiness
    ) {
        val configuration: ReviewReactionLottieConfiguration = configurations[variant]
            ?: error("Review reaction Lottie configuration is missing. variant=${variant.debugIdentifier}")

        configuration.readiness = readiness
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
fun rememberReviewReactionLottieConfigurationStore(): ReviewReactionLottieConfigurationStore {
    val configurationStore: ReviewReactionLottieConfigurationStore =
        remember { createReviewReactionLottieConfigurationStore() }

    reviewReactionLottieAssetConfigurations.forEach { assetConfiguration: ReviewReactionLottieAssetConfiguration ->
        val readiness: ReviewReactionLottieReadiness = rememberReviewReactionLottieReadiness(
            assetConfiguration = assetConfiguration
        )
        SideEffect {
            configurationStore.updateReadiness(
                variant = assetConfiguration.variant,
                readiness = readiness
            )
        }
    }

    return configurationStore
}

private fun createReviewReactionLottieConfigurationStore(): ReviewReactionLottieConfigurationStore {
    val configurations: Map<ReviewReactionVariant, ReviewReactionLottieConfiguration> =
        reviewReactionLottieAssetConfigurations.associate { assetConfiguration: ReviewReactionLottieAssetConfiguration ->
            assetConfiguration.variant to ReviewReactionLottieConfiguration(
                initialReadiness = ReviewReactionLottieReadiness.Pending,
                frameScale = assetConfiguration.frameScale
            )
        }

    return ReviewReactionLottieConfigurationStore(configurations = configurations)
}

@Composable
private fun rememberReviewReactionLottieReadiness(
    assetConfiguration: ReviewReactionLottieAssetConfiguration
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
            logReviewReactionLottieWarning(
                assetConfiguration = assetConfiguration,
                error = compositionFailure
            )
        }
        return ReviewReactionLottieReadiness.Failed(error = compositionFailure)
    }

    return ReviewReactionLottieReadiness.Pending
}

private fun logReviewReactionLottieWarning(
    assetConfiguration: ReviewReactionLottieAssetConfiguration,
    error: Throwable
) {
    Log.w(
        reviewReactionLogTag,
        "Review reaction Lottie asset failed to load. " +
            "assetName=${assetConfiguration.assetName} rawResourceId=${assetConfiguration.rawResourceId}",
        error
    )
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

internal fun reviewReactionFallbackVariantForReadiness(
    readiness: ReviewReactionLottieReadiness
): ReviewReactionVariant? {
    return when (readiness) {
        is ReviewReactionLottieReadiness.Ready,
        ReviewReactionLottieReadiness.Pending -> null
        is ReviewReactionLottieReadiness.Failed -> reviewReactionLottieFallbackVariant
    }
}
