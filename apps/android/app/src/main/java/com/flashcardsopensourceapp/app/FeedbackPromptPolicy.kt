package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.feedback.FeedbackPromptReviewActivity
import java.time.Instant
import java.time.ZoneId

const val automaticFeedbackPromptReviewThreshold: Int = 15
const val automaticFeedbackPromptCooldownMillis: Long = 30L * 24L * 60L * 60L * 1_000L
const val feedbackStateStaleMillis: Long = 24L * 60L * 60L * 1_000L
const val feedbackStateFetchRetryThrottleMillis: Long = 60L * 60L * 1_000L

data class FeedbackPromptLocalState(
    val lastAutomaticFeedbackPromptShownAtMillis: Long?,
    val lastFeedbackSubmittedAtMillis: Long?,
    val nextAutomaticFeedbackPromptAtMillis: Long?,
    val lastFeedbackStateFetchedAtMillis: Long?,
    val lastFeedbackStateFetchAttemptAtMillis: Long?,
    val draftMessage: String
)

@JvmInline
value class FeedbackPromptIdentityKey(
    val value: String
)

data class FeedbackPromptContext(
    val isAppResumed: Boolean,
    val isAuthFlowActive: Boolean,
    val isAppModalActive: Boolean
)

data class FeedbackPromptLocalDayWindow(
    val startMillis: Long,
    val endMillis: Long
)

fun feedbackPromptIdentityKey(cloudSettings: CloudSettings): FeedbackPromptIdentityKey {
    val linkedUserId = cloudSettings.linkedUserId?.trim()?.takeIf { value ->
        value.isNotEmpty()
    }
    if (linkedUserId != null) {
        return FeedbackPromptIdentityKey(value = "user:$linkedUserId")
    }

    return FeedbackPromptIdentityKey(value = "installation:${cloudSettings.installationId}")
}

fun feedbackPromptLocalDayWindow(nowMillis: Long, zoneId: ZoneId): FeedbackPromptLocalDayWindow {
    val localDate = Instant.ofEpochMilli(nowMillis).atZone(zoneId).toLocalDate()
    return FeedbackPromptLocalDayWindow(
        startMillis = localDate.atStartOfDay(zoneId).toInstant().toEpochMilli(),
        endMillis = localDate.plusDays(1L).atStartOfDay(zoneId).toInstant().toEpochMilli()
    )
}

fun isAutomaticFeedbackPromptLocallyEligible(
    reviewActivity: FeedbackPromptReviewActivity,
    promptState: FeedbackPromptLocalState,
    nowMillis: Long,
    context: FeedbackPromptContext
): Boolean {
    if (context.isAppResumed.not() || context.isAuthFlowActive || context.isAppModalActive) {
        return false
    }
    if (reviewActivity.currentLocalDayReviewCount < automaticFeedbackPromptReviewThreshold) {
        return false
    }
    if (reviewActivity.hasPreviousLocalReviewDay.not()) {
        return false
    }
    if (feedbackPromptCooldownIsActive(promptState = promptState, nowMillis = nowMillis)) {
        return false
    }

    return true
}

fun shouldFetchFeedbackState(promptState: FeedbackPromptLocalState, nowMillis: Long): Boolean {
    val lastFetchedAtMillis = promptState.lastFeedbackStateFetchedAtMillis ?: return true
    return nowMillis - lastFetchedAtMillis >= feedbackStateStaleMillis
}

fun canAttemptFeedbackStateFetch(promptState: FeedbackPromptLocalState, nowMillis: Long): Boolean {
    val lastAttemptAtMillis = promptState.lastFeedbackStateFetchAttemptAtMillis ?: return true
    return nowMillis - lastAttemptAtMillis >= feedbackStateFetchRetryThrottleMillis
}

fun nextAutomaticFeedbackPromptAtMillis(nowMillis: Long): Long {
    return nowMillis + automaticFeedbackPromptCooldownMillis
}

private fun feedbackPromptCooldownIsActive(
    promptState: FeedbackPromptLocalState,
    nowMillis: Long
): Boolean {
    val nextPromptAtMillis = promptState.nextAutomaticFeedbackPromptAtMillis
        ?: deriveNextPromptAtMillis(promptState = promptState)
        ?: return false

    return nextPromptAtMillis > nowMillis
}

private fun deriveNextPromptAtMillis(promptState: FeedbackPromptLocalState): Long? {
    val latestPromptOrSubmission = listOfNotNull(
        promptState.lastAutomaticFeedbackPromptShownAtMillis,
        promptState.lastFeedbackSubmittedAtMillis
    ).maxOrNull() ?: return null

    return latestPromptOrSubmission + automaticFeedbackPromptCooldownMillis
}
