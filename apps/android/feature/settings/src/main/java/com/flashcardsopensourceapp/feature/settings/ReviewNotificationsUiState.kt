package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.defaultReviewNotificationsSettings

enum class ReviewNotificationPermissionUiStatus {
    ALLOWED,
    NOT_REQUESTED,
    BLOCKED
}

data class ReviewNotificationsUiState(
    val workspaceId: String?,
    val workspaceName: String,
    val settings: ReviewNotificationsSettings,
    val hasRequestedSystemPermission: Boolean
)

fun initialReviewNotificationsUiState(): ReviewNotificationsUiState {
    return ReviewNotificationsUiState(
        workspaceId = null,
        workspaceName = "",
        settings = defaultReviewNotificationsSettings(),
        hasRequestedSystemPermission = false
    )
}
