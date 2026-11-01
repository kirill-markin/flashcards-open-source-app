package com.flashcardsopensourceapp.app.prompts.guestreview

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GuestSignInAfterReviewPromptPolicyTest {
    @Test
    fun guestIsAllowed() {
        assertTrue(
            isGuestSignInAfterReviewPromptAllowed(
                cloudState = CloudAccountState.GUEST,
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
                isGuestSignInAfterReviewPromptAllowed(
                    cloudState = cloudState,
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
                isGuestSignInAfterReviewPromptAllowed(
                    cloudState = CloudAccountState.GUEST,
                    context = context
                )
            )
        }
    }

    private fun unblockedContext(): GuestSignInAfterReviewPromptContext {
        return GuestSignInAfterReviewPromptContext(
            isAuthFlowActive = false,
            isAppModalActive = false
        )
    }
}
