package com.flashcardsopensourceapp.data.local.model.cloud

import kotlinx.serialization.Serializable

enum class CloudAccountState {
    DISCONNECTED,
    LINKING_READY,
    GUEST,
    LINKED
}

@Serializable
enum class CloudServiceConfigurationMode {
    OFFICIAL,
    CUSTOM
}

@Serializable
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

@Serializable
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

@Serializable
data class CloudWorkspaceSummary(
    val workspaceId: String,
    val name: String,
    val createdAtMillis: Long,
    val isSelected: Boolean,
    val isVisible: Boolean = true
)

@Serializable
enum class CloudGuestUpgradeMode {
    BOUND,
    MERGE_REQUIRED
}

data class CloudGuestUpgradePreparation(
    val mode: CloudGuestUpgradeMode,
    val demoOnlyDestinationWorkspaceId: String?
)

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
        val workspaceId: String,
        val discardDemoOnly: Boolean
    ) : CloudGuestUpgradeSelection

    /** A null name sends no name, so the server applies its automatic workspace name. */
    data class CreateNew(
        val name: String?
    ) : CloudGuestUpgradeSelection
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

@Serializable
sealed interface CloudWorkspaceLinkSelection {
    @Serializable
    data class Existing(
        val workspaceId: String,
        val discardDemoOnly: Boolean = false
    ) : CloudWorkspaceLinkSelection

    /**
     * [name] is the name the user typed; null marks an automatic creation that keeps the automatic
     * workspace name. The default keeps selections persisted before the name existed decodable.
     */
    @Serializable
    data class CreateNew(
        val name: String? = null
    ) : CloudWorkspaceLinkSelection
}

@Serializable
enum class CloudWorkspacePostAuthRoute {
    NONE,
    LINKED_CREDENTIAL_RESTORE,
    GUEST_LOCAL_RECOVERY,
    PENDING_GUEST_UPGRADE_RECOVERY,
    INVALID_STORED_STATE
}

@Serializable
data class CloudWorkspaceLinkContext(
    val userId: String,
    val email: String?,
    val credentials: StoredCloudCredentials,
    val workspaces: List<CloudWorkspaceSummary>,
    val postAuthRoute: CloudWorkspacePostAuthRoute,
    val guestUpgradeMode: CloudGuestUpgradeMode?,
    val preferredWorkspaceId: String?,
    val demoOnlyDestinationWorkspaceId: String? = null
) {
    init {
        require(demoOnlyDestinationWorkspaceId == null ||
            (guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED &&
                postAuthRoute == CloudWorkspacePostAuthRoute.NONE &&
                demoOnlyDestinationWorkspaceId.isNotBlank() &&
                workspaces.any { it.workspaceId == demoOnlyDestinationWorkspaceId })) {
            "Demo-only guest upgrade requires an existing destination workspace and merge-required preparation."
        }
    }
}

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
