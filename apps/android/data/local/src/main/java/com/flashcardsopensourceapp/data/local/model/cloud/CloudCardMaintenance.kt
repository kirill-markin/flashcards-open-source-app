package com.flashcardsopensourceapp.data.local.model.cloud

enum class CloudCardMaintenanceKind(val wireValue: String) {
    RESET_CARD("resetCard"),
    RESET_DECK("resetDeck"),
    RESET_TAG("resetTag"),
    REMOVE_TAG("removeTag")
}

data class CloudCardMaintenanceTarget(
    val workspaceId: String,
    val kind: CloudCardMaintenanceKind,
    val target: String
)

data class CloudCardMaintenancePreview(
    val targetName: String,
    val affectedCardsCount: Int,
    val confirmationText: String,
    val previewFingerprint: String,
    val includesAllCards: Boolean,
    val affectedDecksCount: Int
)

data class CloudCardMaintenanceConfirmation(
    val attemptId: String,
    val target: CloudCardMaintenanceTarget,
    val confirmationText: String,
    val previewFingerprint: String
)

data class CloudCardMaintenanceAttempt(
    val attemptId: String,
    val previewFingerprint: String,
    val affectedCardsCount: Int?,
    val isRefreshComplete: Boolean
)

internal class CloudCardMaintenanceStillPendingException :
    IllegalStateException("Card maintenance is still being resolved. Wait up to two minutes after the preview, then retry sync.")

class CloudCardMaintenanceSignInRequiredException(cause: Throwable?) :
    IllegalStateException("Card maintenance requires a signed-in account linked to this workspace.", cause)

class CloudCardMaintenanceWorkspaceChangedException :
    IllegalStateException("The active workspace changed before card maintenance.")

class CloudCardMaintenanceRefreshException(val affectedCardsCount: Int, cause: Exception) :
    IllegalStateException("Card maintenance succeeded but workspace sync failed.", cause)
