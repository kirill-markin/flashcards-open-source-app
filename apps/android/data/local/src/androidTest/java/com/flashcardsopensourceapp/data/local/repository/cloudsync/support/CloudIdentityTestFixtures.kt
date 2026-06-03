package com.flashcardsopensourceapp.data.local.repository.cloudsync.support

import android.content.Context
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDroppedEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDroppedEntityType
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeReconciliation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession

internal fun clearCloudAndAiPreferences(context: Context) {
    context.deleteSharedPreferences("flashcards-cloud-metadata")
    context.deleteSharedPreferences("flashcards-cloud-secrets")
    context.deleteSharedPreferences("flashcards-review-preferences")
    context.deleteSharedPreferences("flashcards-ai-chat-preferences")
    context.deleteSharedPreferences("flashcards-ai-chat-history")
    context.deleteSharedPreferences("flashcards-ai-chat-guest-session")
}

internal fun createStoredCloudCredentials(idTokenExpiresAtMillis: Long): StoredCloudCredentials {
    return StoredCloudCredentials(
        refreshToken = "refresh-token",
        idToken = "id-token",
        idTokenExpiresAtMillis = idTokenExpiresAtMillis
    )
}

internal fun createOtpChallenge(email: String): CloudOtpChallenge {
    return CloudOtpChallenge(
        email = email,
        csrfToken = "csrf",
        otpSessionToken = "otp"
    )
}

internal fun createStoredGuestAiSession(
    workspaceId: String,
    configurationMode: CloudServiceConfigurationMode,
    apiBaseUrl: String,
    guestToken: String,
    userId: String
): StoredGuestAiSession {
    return StoredGuestAiSession(
        guestToken = guestToken,
        userId = userId,
        workspaceId = workspaceId,
        configurationMode = configurationMode,
        apiBaseUrl = apiBaseUrl
    )
}

internal fun createCloudWorkspaceSummary(
    workspaceId: String,
    name: String,
    createdAtMillis: Long,
    isSelected: Boolean
): CloudWorkspaceSummary {
    return CloudWorkspaceSummary(
        workspaceId = workspaceId,
        name = name,
        createdAtMillis = createdAtMillis,
        isSelected = isSelected
    )
}

internal fun createCloudAccountSnapshot(
    userId: String,
    email: String,
    workspaces: List<CloudWorkspaceSummary>
): CloudAccountSnapshot {
    return CloudAccountSnapshot(
        userId = userId,
        email = email,
        workspaces = workspaces
    )
}

internal fun createCloudGuestUpgradeReconciliation(
    cardIds: List<String>,
    deckIds: List<String>,
    reviewEventIds: List<String>
): CloudGuestUpgradeReconciliation {
    return CloudGuestUpgradeReconciliation(
        droppedEntities = buildList {
            cardIds.forEach { cardId ->
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.CARD,
                        entityId = cardId
                    )
                )
            }
            deckIds.forEach { deckId ->
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.DECK,
                        entityId = deckId
                    )
                )
            }
            reviewEventIds.forEach { reviewEventId ->
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.REVIEW_EVENT,
                        entityId = reviewEventId
                    )
                )
            }
        }
    )
}

internal fun syncStateEntityWithEmptyProgress(workspaceId: String): SyncStateEntity {
    return SyncStateEntity(
        workspaceId = workspaceId,
        lastSyncCursor = null,
        lastReviewSequenceId = 0L,
        hasHydratedHotState = false,
        hasHydratedReviewHistory = false,
        pendingReviewHistoryImport = false,
        lastSyncAttemptAtMillis = null,
        lastSuccessfulSyncAtMillis = null,
        lastSyncError = null,
        blockedInstallationId = null
    )
}
