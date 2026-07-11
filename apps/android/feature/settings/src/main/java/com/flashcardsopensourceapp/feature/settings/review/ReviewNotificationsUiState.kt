package com.flashcardsopensourceapp.feature.settings.review

import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.StrictRemindersSettings
import com.flashcardsopensourceapp.data.local.notifications.defaultReviewNotificationsSettings
import com.flashcardsopensourceapp.data.local.notifications.defaultStrictRemindersSettings

enum class ReviewNotificationPermissionUiStatus {
    ALLOWED,
    NOT_REQUESTED,
    BLOCKED
}

data class ReviewNotificationsUiState(
    val isLoaded: Boolean,
    val settings: ReviewNotificationsSettings,
    val strictRemindersSettings: StrictRemindersSettings,
    val hasRequestedSystemPermission: Boolean
)

fun initialReviewNotificationsUiState(): ReviewNotificationsUiState {
    return ReviewNotificationsUiState(
        isLoaded = false,
        settings = defaultReviewNotificationsSettings(),
        strictRemindersSettings = defaultStrictRemindersSettings(),
        hasRequestedSystemPermission = false
    )
}
