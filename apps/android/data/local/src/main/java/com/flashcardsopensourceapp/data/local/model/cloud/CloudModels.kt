package com.flashcardsopensourceapp.data.local.model.cloud

enum class CloudAccountState {
    DISCONNECTED,
    LINKING_READY,
    GUEST,
    LINKED
}

enum class CloudServiceConfigurationMode {
    OFFICIAL,
    CUSTOM
}

data class CloudServiceConfiguration(
    val mode: CloudServiceConfigurationMode,
    val customOrigin: String?,
    val apiBaseUrl: String,
    val authBaseUrl: String
)

data class CloudServerOverride(
    val customOrigin: String
)

data class CloudOtpChallenge(
    val email: String,
    val csrfToken: String,
    val otpSessionToken: String
)

data class StoredCloudCredentials(
    val refreshToken: String,
    val idToken: String,
    val idTokenExpiresAtMillis: Long
)

data class CloudIdentityToken(
    val idToken: String,
    val idTokenExpiresAtMillis: Long
)

sealed interface CloudSendCodeResult {
    data class OtpRequired(
        val challenge: CloudOtpChallenge
    ) : CloudSendCodeResult

    data class Verified(
        val credentials: StoredCloudCredentials
    ) : CloudSendCodeResult
}

data class CloudWorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val createdAtMillis: Long,
    val isSelected: Boolean
)

enum class CloudGuestUpgradeMode {
    BOUND,
    MERGE_REQUIRED
}

enum class CloudGuestUpgradeDroppedEntityType {
    CARD,
    DECK,
    REVIEW_EVENT
}

data class CloudGuestUpgradeDroppedEntity(
    val entityType: CloudGuestUpgradeDroppedEntityType,
    val entityId: String
)

data class CloudGuestUpgradeReconciliation(
    val droppedEntities: List<CloudGuestUpgradeDroppedEntity>
)

data class CloudGuestUpgradeCompletion(
    val workspace: CloudWorkspaceSummary,
    val reconciliation: CloudGuestUpgradeReconciliation?
)

sealed interface CloudGuestUpgradeSelection {
    data class Existing(
        val workspaceId: String
    ) : CloudGuestUpgradeSelection

    data object CreateNew : CloudGuestUpgradeSelection
}

data class CloudWorkspaceDeletePreview(
    val workspaceId: String,
    val workspaceName: String,
    val activeCardCount: Int,
    val confirmationText: String,
    val isLastAccessibleWorkspace: Boolean
)

data class CloudWorkspaceDeleteResult(
    val ok: Boolean,
    val deletedWorkspaceId: String,
    val deletedCardsCount: Int,
    val workspace: CloudWorkspaceSummary
)

data class CloudWorkspaceResetProgressPreview(
    val workspaceId: String,
    val workspaceName: String,
    val cardsToResetCount: Int,
    val confirmationText: String
)

data class CloudWorkspaceResetProgressResult(
    val ok: Boolean,
    val workspaceId: String,
    val cardsResetCount: Int
)

data class AgentApiKeyConnection(
    val connectionId: String,
    val label: String,
    val createdAtMillis: Long,
    val lastUsedAtMillis: Long?,
    val revokedAtMillis: Long?
)

data class AgentApiKeyConnectionsResult(
    val connections: List<AgentApiKeyConnection>,
    val instructions: String
)

sealed interface CloudWorkspaceLinkSelection {
    data class Existing(
        val workspaceId: String
    ) : CloudWorkspaceLinkSelection

    data object CreateNew : CloudWorkspaceLinkSelection
}

enum class CloudWorkspacePostAuthRoute {
    NONE,
    LINKED_CREDENTIAL_RESTORE,
    GUEST_LOCAL_RECOVERY,
    PENDING_GUEST_UPGRADE_RECOVERY,
    INVALID_STORED_STATE
}

data class CloudWorkspaceLinkContext(
    val userId: String,
    val email: String?,
    val credentials: StoredCloudCredentials,
    val workspaces: List<CloudWorkspaceSummary>,
    val postAuthRoute: CloudWorkspacePostAuthRoute,
    val guestUpgradeMode: CloudGuestUpgradeMode?,
    val preferredWorkspaceId: String?
)

data class CloudSettings(
    val installationId: String,
    val cloudState: CloudAccountState,
    val linkedUserId: String?,
    val linkedWorkspaceId: String?,
    val linkedEmail: String?,
    val activeWorkspaceId: String?,
    val updatedAtMillis: Long
)

enum class CloudCredentialRecoveryReason {
    LINKED_CREDENTIALS_MISSING,
    GUEST_SESSION_MISSING,
    INVALID_STORED_STATE
}

data class CloudCredentialRecoveryState(
    val reason: CloudCredentialRecoveryReason,
    val previousCloudState: CloudAccountState,
    val installationId: String,
    val linkedUserId: String?,
    val linkedWorkspaceId: String?,
    val activeWorkspaceId: String?,
    val linkedEmail: String?,
    val configurationMode: CloudServiceConfigurationMode,
    val apiBaseUrl: String,
    val detectedAtMillis: Long
)

const val cloudCredentialRecoveryRequiredMessage: String =
    "Cloud credential recovery is required before cloud access can continue."

class CloudCredentialRecoveryRequiredException(
    val recoveryState: CloudCredentialRecoveryState
) : IllegalStateException(
    cloudCredentialRecoveryRequiredMessage
)

sealed interface AccountDeletionState {
    data object Hidden : AccountDeletionState

    data object InProgress : AccountDeletionState

    data class Failed(
        val message: String,
        val technicalDetailsReportId: String
    ) : AccountDeletionState
}
