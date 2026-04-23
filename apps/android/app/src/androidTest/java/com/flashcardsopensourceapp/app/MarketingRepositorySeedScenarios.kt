package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import java.time.Instant
import java.time.ZoneId

private data class MarketingReviewTimestamp(
    val daysAgo: Long,
    val hour: Int,
    val minute: Int
)

internal fun marketingReviewRepositorySeedScenario(
    localeConfig: MarketingScreenshotLocaleConfig
): RepositorySeedScenario {
    return RepositorySeedScenario(
        cards = listOf(
            RepositorySeedCard(
                frontText = localeConfig.reviewCard.frontText,
                backText = localeConfig.reviewCard.backText,
                tags = localeConfig.reviewCard.tags,
                effortLevel = EffortLevel.MEDIUM,
                reviews = emptyList()
            )
        )
    )
}

internal fun marketingCardsRepositorySeedScenario(
    localeConfig: MarketingScreenshotLocaleConfig
): RepositorySeedScenario {
    return RepositorySeedScenario(
        cards = localeConfig.cards.map { card ->
            RepositorySeedCard(
                frontText = card.frontText,
                backText = card.backText,
                tags = listOf(card.subjectTag),
                effortLevel = EffortLevel.MEDIUM,
                reviews = emptyList()
            )
        }
    )
}

internal fun marketingProgressRepositorySeedScenario(
    localeConfig: MarketingScreenshotLocaleConfig,
    nowMillis: Long
): RepositorySeedScenario {
    require(localeConfig.cards.size >= 5) {
        "Marketing progress screenshot requires at least 5 seeded cards."
    }
    val zoneId: ZoneId = ZoneId.systemDefault()
    val reviewTimestamps: List<MarketingReviewTimestamp> = listOf(
        MarketingReviewTimestamp(daysAgo = 6L, hour = 10, minute = 0),
        MarketingReviewTimestamp(daysAgo = 4L, hour = 10, minute = 0),
        MarketingReviewTimestamp(daysAgo = 2L, hour = 10, minute = 0),
        MarketingReviewTimestamp(daysAgo = 1L, hour = 10, minute = 0),
        MarketingReviewTimestamp(daysAgo = 0L, hour = 9, minute = 30)
    )

    return RepositorySeedScenario(
        cards = localeConfig.cards.take(reviewTimestamps.size).zip(reviewTimestamps).map { (card, reviewTimestamp) ->
            RepositorySeedCard(
                frontText = card.frontText,
                backText = card.backText,
                tags = listOf(card.subjectTag),
                effortLevel = EffortLevel.MEDIUM,
                reviews = listOf(
                    RepositorySeedReview(
                        rating = ReviewRating.GOOD,
                        reviewedAtMillis = resolveMarketingReviewTimestampMillis(
                            nowMillis = nowMillis,
                            zoneId = zoneId,
                            reviewTimestamp = reviewTimestamp
                        )
                    )
                )
            )
        }
    )
}

private fun resolveMarketingReviewTimestampMillis(
    nowMillis: Long,
    zoneId: ZoneId,
    reviewTimestamp: MarketingReviewTimestamp
): Long {
    val now = Instant.ofEpochMilli(nowMillis).atZone(zoneId)
    val startOfTodayMillis: Long = now.toLocalDate()
        .atStartOfDay(zoneId)
        .toInstant()
        .toEpochMilli()
    val scheduledReview: Long = now.toLocalDate()
        .minusDays(reviewTimestamp.daysAgo)
        .atTime(reviewTimestamp.hour, reviewTimestamp.minute)
        .atZone(zoneId)
        .toInstant()
        .toEpochMilli()
    if (scheduledReview < nowMillis) {
        return scheduledReview
    }

    require(reviewTimestamp.daysAgo == 0L) {
        "Resolved marketing review timestamp must be in the past. nowMillis=$nowMillis scheduledReview=$scheduledReview"
    }
    val fallbackReviewMillis: Long = now.minusSeconds(1).toInstant().toEpochMilli()
    return if (fallbackReviewMillis >= startOfTodayMillis) {
        fallbackReviewMillis
    } else {
        startOfTodayMillis
    }
}
