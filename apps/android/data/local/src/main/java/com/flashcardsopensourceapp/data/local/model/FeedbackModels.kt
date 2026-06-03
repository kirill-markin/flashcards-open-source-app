package com.flashcardsopensourceapp.data.local.model

const val cloudFeedbackMessageMaximumLength: Int = 5000

enum class CloudFeedbackTrigger(
    val wireValue: String
) {
    SETTINGS(wireValue = "settings"),
    AUTOMATIC(wireValue = "automatic")
}

enum class CloudFeedbackPromptEventType(
    val wireValue: String
) {
    AUTOMATIC_PROMPT_SHOWN(wireValue = "automatic_prompt_shown")
}

data class CloudFeedbackState(
    val lastAutomaticPromptShownAtMillis: Long?,
    val lastFeedbackSubmittedAtMillis: Long?,
    val nextAutomaticPromptAtMillis: Long?
)

data class CloudFeedbackPromptEventRequest(
    val feedbackPromptEventId: String,
    val workspaceId: String?,
    val installationId: String?,
    val platform: String,
    val appVersion: String?,
    val locale: String,
    val timezone: String,
    val eventType: CloudFeedbackPromptEventType,
    val createdAtClient: String
)

data class CloudFeedbackSubmissionRequest(
    val feedbackSubmissionId: String,
    val workspaceId: String?,
    val installationId: String?,
    val platform: String,
    val appVersion: String?,
    val locale: String,
    val timezone: String,
    val trigger: CloudFeedbackTrigger,
    val message: String,
    val createdAtClient: String
)

data class FeedbackPromptReviewActivity(
    val currentLocalDayReviewCount: Int,
    val hasPreviousLocalReviewDay: Boolean
)
