package com.flashcardsopensourceapp.data.local.review.prompts

import java.time.Instant
import java.time.ZoneId

private const val millisPerDay: Long = 24L * 60L * 60L * 1_000L

/**
 * Review log timestamps are counted per quarter hour. Every time zone offset in use is a whole
 * number of quarter hours, so one bucket never spans two local dates.
 */
const val reviewPromptTimeBucketMillis: Long = 15L * 60L * 1_000L

data class ReviewPromptCounters(
    val totalReviews: Int,
    val reviewsToday: Int,
    val reviewDays: Int
)

/** One prompt as the walk sees it; ids without a handler are prompts this platform lacks. */
data class ReviewPromptHandler(
    /** The prompt's own last showing, the only clock its `cooldownDays` counts from. */
    val loadLastShownAtMillis: suspend () -> Long?,
    /** Applies the prompt's fixed rules and shows it; false when they do not pass. */
    val tryShow: suspend (reviewPromptConfigVersion: String) -> Boolean
)

fun countReviewPromptDays(timeBuckets: List<Long>, zoneId: ZoneId): Int {
    return timeBuckets.map { bucket ->
        Instant.ofEpochMilli(bucket * reviewPromptTimeBucketMillis).atZone(zoneId).toLocalDate()
    }.distinct().size
}

fun passesReviewPromptConditions(settings: ReviewPromptSettings, counters: ReviewPromptCounters): Boolean {
    return settings.enabled &&
        counters.totalReviews >= (settings.minTotalReviews ?: 0) &&
        counters.reviewsToday >= (settings.minReviewsToday ?: 0) &&
        counters.reviewDays >= (settings.minReviewDays ?: 0)
}

fun isReviewPromptCooldownElapsed(cooldownDays: Int, lastShownAtMillis: Long?, nowMillis: Long): Boolean {
    return lastShownAtMillis == null || nowMillis - lastShownAtMillis >= cooldownDays * millisPerDay
}

/**
 * Walks [ReviewPromptConfig.order] after a saved review and shows the first prompt that passes its
 * config conditions and its own fixed rules. Stops after one prompt, and as soon as the review
 * surface cannot present one: a busy surface skips this review with no retry.
 */
suspend fun showFirstEligibleReviewPrompt(
    config: ReviewPromptConfig,
    counters: ReviewPromptCounters,
    nowMillis: Long,
    handlers: Map<ReviewPromptId, ReviewPromptHandler>,
    canPresent: () -> Boolean
) {
    for (promptId in config.order) {
        val handler = handlers[promptId] ?: continue
        if (canPresent().not()) {
            return
        }
        val settings = config.prompts[promptId] ?: continue
        if (passesReviewPromptConditions(settings = settings, counters = counters).not()) {
            continue
        }
        val cooldownDays = settings.cooldownDays
        if (
            cooldownDays != null &&
            isReviewPromptCooldownElapsed(
                cooldownDays = cooldownDays,
                lastShownAtMillis = handler.loadLastShownAtMillis(),
                nowMillis = nowMillis
            ).not()
        ) {
            continue
        }
        if (handler.tryShow(config.version)) {
            return
        }
    }
}
