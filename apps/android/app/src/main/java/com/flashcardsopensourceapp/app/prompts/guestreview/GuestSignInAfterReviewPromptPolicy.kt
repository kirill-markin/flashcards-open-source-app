package com.flashcardsopensourceapp.app.prompts.guestreview

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState

data class GuestSignInAfterReviewPromptContext(
    val isAuthFlowActive: Boolean,
    val isAppModalActive: Boolean
)

/** The prompt's fixed rule: guests only, so it stops once the person is no longer a guest. */
fun isGuestSignInAfterReviewPromptAllowed(
    cloudState: CloudAccountState,
    context: GuestSignInAfterReviewPromptContext
): Boolean {
    return cloudState == CloudAccountState.GUEST &&
        context.isAuthFlowActive.not() &&
        context.isAppModalActive.not()
}
