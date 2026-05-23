package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.model.CloudAccountState

const val guestSignInAfterReviewPromptReviewThreshold: Int = 20
const val guestSignInAfterReviewPromptSnoozeMillis: Long = 7L * 24L * 60L * 60L * 1_000L

data class GuestSignInAfterReviewPromptState(
    val lastShownAtMillis: Long?,
    val snoozedUntilMillis: Long?,
    val lastShownReviewCount: Int?,
    val acceptedAtMillis: Long?
)

data class GuestSignInAfterReviewPromptContext(
    val isAuthFlowActive: Boolean,
    val isAppModalActive: Boolean
)

fun isGuestSignInAfterReviewPromptVisible(
    cloudState: CloudAccountState,
    reviewedCount: Int,
    promptState: GuestSignInAfterReviewPromptState,
    nowMillis: Long,
    context: GuestSignInAfterReviewPromptContext
): Boolean {
    if (cloudState != CloudAccountState.GUEST) {
        return false
    }
    if (reviewedCount < guestSignInAfterReviewPromptReviewThreshold) {
        return false
    }
    if (promptState.acceptedAtMillis != null) {
        return false
    }
    if (promptState.snoozedUntilMillis != null && promptState.snoozedUntilMillis > nowMillis) {
        return false
    }
    if (context.isAuthFlowActive || context.isAppModalActive) {
        return false
    }

    return true
}
