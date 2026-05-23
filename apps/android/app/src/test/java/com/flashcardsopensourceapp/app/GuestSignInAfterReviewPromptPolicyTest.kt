package com.flashcardsopensourceapp.app

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GuestSignInAfterReviewPromptPolicyTest {
    @Test
    fun guestWithNineteenReviewsIsHidden() {
        assertFalse(
            isGuestSignInAfterReviewPromptVisible(
                cloudState = CloudAccountState.GUEST,
                reviewedCount = 19,
                promptState = emptyPromptState(),
                nowMillis = 1_000L,
                context = unblockedContext()
            )
        )
    }

    @Test
    fun guestWithTwentyReviewsIsVisible() {
        assertTrue(
            isGuestSignInAfterReviewPromptVisible(
                cloudState = CloudAccountState.GUEST,
                reviewedCount = 20,
                promptState = emptyPromptState(),
                nowMillis = 1_000L,
                context = unblockedContext()
            )
        )
    }

    @Test
    fun nonGuestCloudStatesAreHidden() {
        listOf(
            CloudAccountState.DISCONNECTED,
            CloudAccountState.LINKING_READY,
            CloudAccountState.LINKED
        ).forEach { cloudState ->
            assertFalse(
                isGuestSignInAfterReviewPromptVisible(
                    cloudState = cloudState,
                    reviewedCount = 20,
                    promptState = emptyPromptState(),
                    nowMillis = 1_000L,
                    context = unblockedContext()
                )
            )
        }
    }

    @Test
    fun authAndModalContextAreHidden() {
        listOf(
            GuestSignInAfterReviewPromptContext(
                isAuthFlowActive = true,
                isAppModalActive = false
            ),
            GuestSignInAfterReviewPromptContext(
                isAuthFlowActive = false,
                isAppModalActive = true
            )
        ).forEach { context ->
            assertFalse(
                isGuestSignInAfterReviewPromptVisible(
                    cloudState = CloudAccountState.GUEST,
                    reviewedCount = 20,
                    promptState = emptyPromptState(),
                    nowMillis = 1_000L,
                    context = context
                )
            )
        }
    }

    @Test
    fun snoozeSuppressesUntilExpiry() {
        val snoozedState = GuestSignInAfterReviewPromptState(
            lastShownAtMillis = 1_000L,
            snoozedUntilMillis = 2_000L,
            lastShownReviewCount = 20,
            acceptedAtMillis = null
        )

        assertFalse(
            isGuestSignInAfterReviewPromptVisible(
                cloudState = CloudAccountState.GUEST,
                reviewedCount = 20,
                promptState = snoozedState,
                nowMillis = 1_999L,
                context = unblockedContext()
            )
        )
        assertTrue(
            isGuestSignInAfterReviewPromptVisible(
                cloudState = CloudAccountState.GUEST,
                reviewedCount = 20,
                promptState = snoozedState,
                nowMillis = 2_000L,
                context = unblockedContext()
            )
        )
    }

    @Test
    fun acceptedStateIsHidden() {
        assertFalse(
            isGuestSignInAfterReviewPromptVisible(
                cloudState = CloudAccountState.GUEST,
                reviewedCount = 20,
                promptState = GuestSignInAfterReviewPromptState(
                    lastShownAtMillis = 1_000L,
                    snoozedUntilMillis = null,
                    lastShownReviewCount = 20,
                    acceptedAtMillis = 1_500L
                ),
                nowMillis = 2_000L,
                context = unblockedContext()
            )
        )
    }

    private fun emptyPromptState(): GuestSignInAfterReviewPromptState {
        return GuestSignInAfterReviewPromptState(
            lastShownAtMillis = null,
            snoozedUntilMillis = null,
            lastShownReviewCount = null,
            acceptedAtMillis = null
        )
    }

    private fun unblockedContext(): GuestSignInAfterReviewPromptContext {
        return GuestSignInAfterReviewPromptContext(
            isAuthFlowActive = false,
            isAppModalActive = false
        )
    }
}
