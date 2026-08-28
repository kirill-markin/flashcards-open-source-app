package com.flashcardsopensourceapp.core.observability.analytics

/**
 * Hand-written mirror of the frozen backend product-analytics catalog.
 *
 * The server keeps a closed allowlist of event names, property names and property values, so this
 * file is deliberately type-strict: there is no `track(name, properties)` anywhere. Every event is
 * its own data class whose constructor arguments are exactly the properties the server declares,
 * which means an event that cannot satisfy the contract does not compile.
 *
 * `guest_upgrade_completed` and `catalog_deck_installed` are server-derived. A client batch that
 * contains either is rejected, so they are absent here on purpose.
 */

/** Named because the delivery path has to recognise a batch that carries nothing else. */
internal const val analyticsEventsDroppedEventName: String = "analytics_events_dropped"

/** Shared cross-platform surface enum for the top-level `screen` field. */
enum class AnalyticsSurface(val wireValue: String) {
    REVIEW(wireValue = "review"),
    CATALOG(wireValue = "catalog"),
    DECK_DETAIL(wireValue = "deck_detail"),
    ONBOARDING(wireValue = "onboarding"),
    CARD_EDITOR(wireValue = "card_editor"),
    CARDS(wireValue = "cards"),
    PROGRESS(wireValue = "progress"),
    SETTINGS(wireValue = "settings"),
    AI(wireValue = "ai")
}

/** Captured when the event is created, never when the batch is flushed. */
enum class AnalyticsNetworkState(val wireValue: String) {
    WIFI(wireValue = "wifi"),
    CELLULAR(wireValue = "cellular"),
    OFFLINE(wireValue = "offline"),
    UNKNOWN(wireValue = "unknown")
}

enum class AnalyticsLaunchType(val wireValue: String) {
    COLD(wireValue = "cold"),
    WARM(wireValue = "warm")
}

enum class AnalyticsOnboardingStep(val wireValue: String) {
    LANGUAGE(wireValue = "language"),
    GOAL(wireValue = "goal"),
    NOTIFICATIONS(wireValue = "notifications"),
    FIRST_DECK(wireValue = "first_deck"),
    FIRST_REVIEW(wireValue = "first_review"),
    SIGNIN(wireValue = "signin")
}

enum class AnalyticsOnboardingOutcome(val wireValue: String) {
    COMPLETED(wireValue = "completed"),
    SKIPPED(wireValue = "skipped")
}

enum class AnalyticsSignInFailureReason(val wireValue: String) {
    INVALID_CODE(wireValue = "invalid_code"),
    EXPIRED_CODE(wireValue = "expired_code"),
    RATE_LIMITED(wireValue = "rate_limited"),
    OFFLINE(wireValue = "offline"),
    SERVER_ERROR(wireValue = "server_error"),
    CANCELLED(wireValue = "cancelled")
}

enum class AnalyticsDeckScope(val wireValue: String) {
    ALL(wireValue = "all"),
    DECK(wireValue = "deck"),
    FILTER(wireValue = "filter")
}

enum class AnalyticsReviewEndReason(val wireValue: String) {
    COMPLETED(wireValue = "completed"),
    ABANDONED(wireValue = "abandoned"),
    INTERRUPTED(wireValue = "interrupted")
}

enum class AnalyticsReviewAnswerFailureReason(val wireValue: String) {
    OFFLINE(wireValue = "offline"),
    TIMEOUT(wireValue = "timeout"),
    SYNC_CONFLICT(wireValue = "sync_conflict"),
    SERVER_ERROR(wireValue = "server_error")
}

enum class AnalyticsCardCreateEntryPoint(val wireValue: String) {
    CARDS(wireValue = "cards"),
    DECK_DETAIL(wireValue = "deck_detail"),
    REVIEW(wireValue = "review"),
    AI(wireValue = "ai"),
    QUICK_ACTION(wireValue = "quick_action")
}

enum class AnalyticsSyncFailureReason(val wireValue: String) {
    OFFLINE(wireValue = "offline"),
    TIMEOUT(wireValue = "timeout"),
    CONFLICT(wireValue = "conflict"),
    UNAUTHORIZED(wireValue = "unauthorized"),
    SERVER_ERROR(wireValue = "server_error"),
    STORAGE_FULL(wireValue = "storage_full")
}

enum class AnalyticsDroppedReason(val wireValue: String) {
    QUEUE_OVERFLOW(wireValue = "queue_overflow"),
    TTL_EXPIRED(wireValue = "ttl_expired"),
    REJECTED(wireValue = "rejected")
}

/**
 * The two property value kinds the server catalog accepts from this client: an exact allowlisted
 * string, and an integer greater than or equal to zero.
 */
sealed interface AnalyticsPropertyValue {
    data class Text(val value: String) : AnalyticsPropertyValue

    data class Count(val value: Int) : AnalyticsPropertyValue
}

sealed interface AnalyticsEvent {
    val eventName: String

    /** Top-level event field, never a property. Legal on every event, required on `screen_viewed`. */
    val screen: AnalyticsSurface?

    val properties: Map<String, AnalyticsPropertyValue>

    data class AppOpened(
        val launchType: AnalyticsLaunchType,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "app_opened"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "launch_type" to AnalyticsPropertyValue.Text(value = launchType.wireValue)
        )
    }

    /** `screen` is non-null here on purpose: the server rejects `screen_viewed` without it. */
    data class ScreenViewed(
        override val screen: AnalyticsSurface
    ) : AnalyticsEvent {
        override val eventName: String = "screen_viewed"
        override val properties: Map<String, AnalyticsPropertyValue> = emptyMap()
    }

    data class OnboardingStepCompleted(
        val step: AnalyticsOnboardingStep,
        val outcome: AnalyticsOnboardingOutcome,
        override val screen: AnalyticsSurface? = AnalyticsSurface.ONBOARDING
    ) : AnalyticsEvent {
        override val eventName: String = "onboarding_step_completed"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "step" to AnalyticsPropertyValue.Text(value = step.wireValue),
            "outcome" to AnalyticsPropertyValue.Text(value = outcome.wireValue)
        )
    }

    data class SignInFailed(
        val reason: AnalyticsSignInFailureReason,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "signin_failed"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue)
        )
    }

    data class ReviewSessionStarted(
        val deckScope: AnalyticsDeckScope,
        override val screen: AnalyticsSurface? = AnalyticsSurface.REVIEW
    ) : AnalyticsEvent {
        override val eventName: String = "review_session_started"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "deck_scope" to AnalyticsPropertyValue.Text(value = deckScope.wireValue)
        )
    }

    data class ReviewSessionEnded(
        val endReason: AnalyticsReviewEndReason,
        val answeredCount: Int,
        val durationMs: Long,
        override val screen: AnalyticsSurface? = AnalyticsSurface.REVIEW
    ) : AnalyticsEvent {
        override val eventName: String = "review_session_ended"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "end_reason" to AnalyticsPropertyValue.Text(value = endReason.wireValue),
            "answered_count" to AnalyticsPropertyValue.Count(value = nonNegativeAnalyticsCount(value = answeredCount.toLong())),
            "duration_ms" to AnalyticsPropertyValue.Count(value = nonNegativeAnalyticsCount(value = durationMs))
        )
    }

    data class ReviewAnswerFailed(
        val reason: AnalyticsReviewAnswerFailureReason,
        override val screen: AnalyticsSurface? = AnalyticsSurface.REVIEW
    ) : AnalyticsEvent {
        override val eventName: String = "review_answer_failed"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue)
        )
    }

    data class CardCreateStarted(
        val entryPoint: AnalyticsCardCreateEntryPoint,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "card_create_started"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "entry_point" to AnalyticsPropertyValue.Text(value = entryPoint.wireValue)
        )
    }

    data class SyncFailed(
        val reason: AnalyticsSyncFailureReason,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = "sync_failed"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue)
        )
    }

    data class CatalogDeckInstallStarted(
        val packageSlug: String,
        override val screen: AnalyticsSurface? = AnalyticsSurface.CATALOG
    ) : AnalyticsEvent {
        override val eventName: String = "catalog_deck_install_started"
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "package_slug" to AnalyticsPropertyValue.Text(value = packageSlug)
        )
    }

    data class AnalyticsEventsDropped(
        val reason: AnalyticsDroppedReason,
        val count: Int,
        override val screen: AnalyticsSurface? = null
    ) : AnalyticsEvent {
        override val eventName: String = analyticsEventsDroppedEventName
        override val properties: Map<String, AnalyticsPropertyValue> = mapOf(
            "reason" to AnalyticsPropertyValue.Text(value = reason.wireValue),
            "count" to AnalyticsPropertyValue.Count(value = nonNegativeAnalyticsCount(value = count.toLong()))
        )
    }
}

/**
 * The server rejects negatives and anything outside the integer range, and a rejected event is
 * reported back only as the generic `invalid_event`. Clamping here keeps a bad caller-side count
 * from silently costing the event.
 */
private fun nonNegativeAnalyticsCount(value: Long): Int {
    return value.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
}
