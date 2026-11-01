package com.flashcardsopensourceapp.app.prompts.feedback

import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings

data class FeedbackPromptLocalState(
    /** The cooldown clock of the automatic prompt; feedback submissions never move it. */
    val lastAutomaticFeedbackPromptShownAtMillis: Long?,
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

fun feedbackPromptIdentityKey(cloudSettings: CloudSettings): FeedbackPromptIdentityKey {
    val linkedUserId = cloudSettings.linkedUserId?.trim()?.takeIf { value ->
        value.isNotEmpty()
    }
    if (linkedUserId != null) {
        return FeedbackPromptIdentityKey(value = "user:$linkedUserId")
    }

    return FeedbackPromptIdentityKey(value = "installation:${cloudSettings.installationId}")
}
