package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCommunityProfile
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.cloud.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardProfile
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccountPreferences
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportPreview
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmOptions
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportConfirmResult
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageImportPreview
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import java.util.Locale
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

internal fun makeCredentials(idToken: String): StoredCloudCredentials {
    return StoredCloudCredentials(
        refreshToken = "refresh-$idToken",
        idToken = idToken,
        idTokenExpiresAtMillis = Long.MAX_VALUE
    )
}

internal fun makeLinkContext(
    credentials: StoredCloudCredentials,
    email: String,
    workspaceId: String,
    workspaceName: String,
    postAuthRoute: CloudWorkspacePostAuthRoute,
    preferredWorkspaceId: String
): CloudWorkspaceLinkContext {
    return CloudWorkspaceLinkContext(
        userId = "user-$workspaceId",
        email = email,
        credentials = credentials,
        workspaces = listOf(
            CloudWorkspaceSummary(
                workspaceId = workspaceId,
                name = workspaceName,
                createdAtMillis = 100L,
                isSelected = true
            )
        ),
        postAuthRoute = postAuthRoute,
        guestUpgradeMode = null,
        preferredWorkspaceId = preferredWorkspaceId
    )
}

internal fun makeRecoveryState(): CloudCredentialRecoveryState {
    return CloudCredentialRecoveryState(
        reason = CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING,
        previousCloudState = CloudAccountState.LINKED,
        installationId = "installation-1",
        linkedUserId = "user-1",
        linkedWorkspaceId = "workspace-local",
        activeWorkspaceId = "workspace-local",
        linkedEmail = "person@example.com",
        configurationMode = makeOfficialCloudServiceConfiguration().mode,
        apiBaseUrl = makeOfficialCloudServiceConfiguration().apiBaseUrl,
        detectedAtMillis = 100L
    )
}

internal data class CapturedWorkspacePackageImportConfirm(
    val fileName: String,
    val packageBytes: ByteArray,
    val options: WorkspacePackageImportConfirmOptions
)

internal data class QueuedWorkspacePackageExportPreview(
    val gate: CompletableDeferred<Unit>,
    val preview: WorkspacePackageExportPreview
)

internal data class QueuedWorkspacePackageImportPreview(
    val gate: CompletableDeferred<Unit>,
    val preview: WorkspacePackageImportPreview
)

internal class FakeCloudAccountRepository : CloudAccountRepository {
    private val cloudSettings = MutableStateFlow(
        CloudSettings(
            installationId = "installation-1",
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = "workspace-local",
            updatedAtMillis = 0L
        )
    )
    private val accountPreferences = MutableStateFlow(defaultAccountPreferences())
    private val accountDeletionState = MutableStateFlow<AccountDeletionState>(AccountDeletionState.Hidden)
    private val serverConfiguration = MutableStateFlow(makeOfficialCloudServiceConfiguration())
    private val cloudCredentialRecoveryState = MutableStateFlow<CloudCredentialRecoveryState?>(null)
    private val sendCodeResults = ArrayDeque<CloudSendCodeResult>()
    private val sendCodeErrors = ArrayDeque<Exception>()
    private val verifyCodeErrors = ArrayDeque<Exception>()
    private val completeCloudLinkErrors = ArrayDeque<Exception>()
    private val completeCloudLinkResults = ArrayDeque<CompletableDeferred<CloudWorkspaceSummary>>()
    private val preparedLinkContexts = mutableMapOf<String, CompletableDeferred<CloudWorkspaceLinkContext>>()
    private val queuedWorkspacePackageExportPreviews = ArrayDeque<QueuedWorkspacePackageExportPreview>()
    private val queuedWorkspacePackageImportPreviews = ArrayDeque<QueuedWorkspacePackageImportPreview>()
    val completeCloudLinkSelections = mutableListOf<CloudWorkspaceLinkSelection>()
    val validatedCustomOrigins = mutableListOf<String>()
    val appliedCustomServerConfigurations = mutableListOf<CloudServiceConfiguration>()
    val previewedWorkspacePackageExportRequests = mutableListOf<WorkspacePackageExportRequest>()
    val exportedWorkspacePackageRequests = mutableListOf<WorkspacePackageExportRequest>()
    val previewedWorkspacePackageImportBytes = mutableListOf<ByteArray>()
    val confirmedWorkspacePackageImports = mutableListOf<CapturedWorkspacePackageImportConfirm>()
    var validateCustomServerError: Exception? = null
    var applyCustomServerError: Exception? = null
    var nextValidatedCustomServerConfiguration: CloudServiceConfiguration? = null
    var nextWorkspacePackageExportPreview: WorkspacePackageExportPreview? = null
    var nextWorkspacePackageExportDownloadResponse: WorkspacePackageExportDownloadResponse? = null
    var nextWorkspacePackageImportPreview: WorkspacePackageImportPreview? = null
    var nextWorkspacePackageImportConfirmGate: CompletableDeferred<Unit>? = null
    var nextWorkspacePackageImportConfirmResult: WorkspacePackageImportConfirmResult? = null
    var resetInvalidCloudCredentialRecoveryStateCalls: Int = 0
        private set
    var logoutCalls: Int = 0
        private set

    fun enqueueSendCodeResult(result: CloudSendCodeResult) {
        sendCodeResults.addLast(result)
    }

    fun enqueueSendCodeError(error: Exception) {
        sendCodeErrors.addLast(error)
    }

    fun enqueueVerifyCodeError(error: Exception) {
        verifyCodeErrors.addLast(error)
    }

    fun enqueueCompleteCloudLinkError(error: Exception) {
        completeCloudLinkErrors.addLast(error)
    }

    fun enqueueCompleteCloudLinkResult(result: CompletableDeferred<CloudWorkspaceSummary>) {
        completeCloudLinkResults.addLast(result)
    }

    fun setCloudSettings(settings: CloudSettings) {
        cloudSettings.value = settings
    }

    fun enqueuePreparedLinkContext(
        idToken: String,
        result: CompletableDeferred<CloudWorkspaceLinkContext>
    ) {
        preparedLinkContexts[idToken] = result
    }

    fun enqueueWorkspacePackageExportPreview(
        gate: CompletableDeferred<Unit>,
        preview: WorkspacePackageExportPreview
    ) {
        queuedWorkspacePackageExportPreviews.addLast(
            QueuedWorkspacePackageExportPreview(
                gate = gate,
                preview = preview
            )
        )
    }

    fun enqueueWorkspacePackageImportPreview(
        gate: CompletableDeferred<Unit>,
        preview: WorkspacePackageImportPreview
    ) {
        queuedWorkspacePackageImportPreviews.addLast(
            QueuedWorkspacePackageImportPreview(
                gate = gate,
                preview = preview
            )
        )
    }

    override fun observeCloudSettings(): Flow<CloudSettings> {
        return cloudSettings
    }

    override fun observeAccountPreferences(): Flow<AccountPreferences> {
        return accountPreferences
    }

    override fun observeAccountDeletionState(): Flow<AccountDeletionState> {
        return accountDeletionState
    }

    override fun observeServerConfiguration(): Flow<CloudServiceConfiguration> {
        return serverConfiguration
    }

    override fun observeCloudCredentialRecoveryState(): Flow<CloudCredentialRecoveryState?> {
        return cloudCredentialRecoveryState
    }

    override suspend fun eraseLocalDataForCredentialRecovery() {
        throw UnsupportedOperationException()
    }

    override suspend fun beginAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun resumePendingAccountDeletionIfNeeded() {
        throw UnsupportedOperationException()
    }

    override suspend fun retryPendingAccountDeletion() {
        throw UnsupportedOperationException()
    }

    override suspend fun refreshAccountContext() {
    }

    override suspend fun updateAccountPreferences(preferences: AccountPreferences): AccountPreferences {
        accountPreferences.value = preferences
        return preferences
    }

    override suspend fun sendCode(email: String): CloudSendCodeResult {
        if (sendCodeErrors.isNotEmpty()) {
            throw sendCodeErrors.removeFirst()
        }
        return sendCodeResults.removeFirst()
    }

    override suspend fun prepareVerifiedSignIn(credentials: StoredCloudCredentials): CloudWorkspaceLinkContext {
        return requireNotNull(preparedLinkContexts[credentials.idToken]) {
            "Missing prepared link context for ${credentials.idToken}"
        }.await()
    }

    override suspend fun verifyCode(challenge: CloudOtpChallenge, code: String): CloudWorkspaceLinkContext {
        if (verifyCodeErrors.isNotEmpty()) {
            throw verifyCodeErrors.removeFirst()
        }
        throw UnsupportedOperationException()
    }

    override suspend fun completeCloudLink(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        completeCloudLinkSelections += selection
        if (completeCloudLinkErrors.isNotEmpty()) {
            throw completeCloudLinkErrors.removeFirst()
        }
        if (completeCloudLinkResults.isNotEmpty()) {
            return completeCloudLinkResults.removeFirst().await()
        }
        return when (selection) {
            is CloudWorkspaceLinkSelection.Existing -> requireNotNull(
                linkContext.workspaces.firstOrNull { workspace -> workspace.workspaceId == selection.workspaceId }
            ) {
                "Selected workspace is missing from test link context."
            }

            CloudWorkspaceLinkSelection.CreateNew -> CloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = "Personal",
                createdAtMillis = 200L,
                isSelected = true
            )
        }
    }

    override suspend fun completeGuestUpgrade(
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun completeLinkedWorkspaceTransition(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun resetInvalidCloudCredentialRecoveryState() {
        resetInvalidCloudCredentialRecoveryStateCalls += 1
    }

    override suspend fun logout() {
        logoutCalls += 1
    }

    override suspend fun renameCurrentWorkspace(name: String): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCurrentWorkspaceDeletePreview(): CloudWorkspaceDeletePreview {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteCurrentWorkspace(confirmationText: String): CloudWorkspaceDeleteResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCurrentWorkspaceResetProgressPreview(): CloudWorkspaceResetProgressPreview {
        throw UnsupportedOperationException()
    }

    override suspend fun resetCurrentWorkspaceProgress(confirmationText: String): CloudWorkspaceResetProgressResult {
        throw UnsupportedOperationException()
    }

    override suspend fun previewCurrentWorkspacePackageExport(
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportPreview {
        previewedWorkspacePackageExportRequests += request
        if (queuedWorkspacePackageExportPreviews.isNotEmpty()) {
            val queuedPreview: QueuedWorkspacePackageExportPreview = queuedWorkspacePackageExportPreviews.removeFirst()
            queuedPreview.gate.await()
            return queuedPreview.preview
        }
        return requireNotNull(nextWorkspacePackageExportPreview) {
            "Missing workspace package export preview test result."
        }
    }

    override suspend fun exportCurrentWorkspacePackage(
        request: WorkspacePackageExportRequest
    ): WorkspacePackageExportDownloadResponse {
        exportedWorkspacePackageRequests += request
        return requireNotNull(nextWorkspacePackageExportDownloadResponse) {
            "Missing workspace package export download test result."
        }
    }

    override suspend fun previewCurrentWorkspacePackageImport(packageBytes: ByteArray): WorkspacePackageImportPreview {
        previewedWorkspacePackageImportBytes += packageBytes.copyOf()
        if (queuedWorkspacePackageImportPreviews.isNotEmpty()) {
            val queuedPreview: QueuedWorkspacePackageImportPreview = queuedWorkspacePackageImportPreviews.removeFirst()
            queuedPreview.gate.await()
            return queuedPreview.preview
        }
        return requireNotNull(nextWorkspacePackageImportPreview) {
            "Missing workspace package import preview test result."
        }
    }

    override suspend fun confirmCurrentWorkspacePackageImport(
        fileName: String,
        packageBytes: ByteArray,
        options: WorkspacePackageImportConfirmOptions
    ): WorkspacePackageImportConfirmResult {
        confirmedWorkspacePackageImports += CapturedWorkspacePackageImportConfirm(
            fileName = fileName,
            packageBytes = packageBytes.copyOf(),
            options = options
        )
        nextWorkspacePackageImportConfirmGate?.await()
        return requireNotNull(nextWorkspacePackageImportConfirmResult) {
            "Missing workspace package import confirm test result."
        }
    }

    override suspend fun loadProgressSummary(timeZone: String): CloudProgressSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressSeries(timeZone: String, from: String, to: String): CloudProgressSeries {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressReviewSchedule(timeZone: String): CloudProgressReviewSchedule {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressLeaderboard(): CloudProgressLeaderboard {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressStreakLeaderboard(): CloudProgressStreakLeaderboard {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressLeaderboardProfile(publicProfileId: String): CloudProgressLeaderboardProfile {
        throw UnsupportedOperationException()
    }

    override suspend fun loadCommunityProfile(): CloudCommunityProfile {
        throw UnsupportedOperationException()
    }

    override suspend fun updateCommunityLeaderboardParticipation(
        leaderboardParticipationEnabled: Boolean
    ): CloudCommunityProfile {
        throw UnsupportedOperationException()
    }

    override suspend fun createFriendInvitation(
        request: CloudFriendInvitationCreateRequest
    ): CloudFriendInvitationCreateResponse {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteAccount(confirmationText: String) {
        throw UnsupportedOperationException()
    }

    override suspend fun listLinkedWorkspaces(): List<CloudWorkspaceSummary> {
        throw UnsupportedOperationException()
    }

    override suspend fun switchLinkedWorkspace(selection: CloudWorkspaceLinkSelection): CloudWorkspaceSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun listAgentConnections(): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun revokeAgentConnection(connectionId: String): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun currentServerConfiguration(): CloudServiceConfiguration {
        return serverConfiguration.value
    }

    override suspend fun validateCustomServer(customOrigin: String): CloudServiceConfiguration {
        validatedCustomOrigins += customOrigin
        val error = validateCustomServerError
        if (error != null) {
            throw error
        }
        return nextValidatedCustomServerConfiguration
            ?: makeCustomCloudServiceConfiguration(customOrigin = customOrigin)
    }

    override suspend fun applyCustomServer(configuration: CloudServiceConfiguration) {
        val error = applyCustomServerError
        if (error != null) {
            throw error
        }
        appliedCustomServerConfigurations += configuration
        serverConfiguration.value = configuration
    }

    override suspend fun resetToOfficialServer() {
        serverConfiguration.value = makeOfficialCloudServiceConfiguration()
    }
}

internal class TestSettingsStringResolver : SettingsStringResolver {
    override fun get(stringResId: Int, vararg formatArgs: Any): String {
        val pattern = when (stringResId) {
            R.string.settings_sign_in_request_code_first -> "Request a sign-in code first."
            R.string.settings_sign_in_cancelled_message -> {
                "Signed-in setup was cancelled. This device is disconnected."
            }

            R.string.settings_sign_in_send_code_transport_failed -> {
                "We could not confirm that the code was sent. Check your connection and try again."
            }

            R.string.settings_sign_in_send_code_failed -> "Could not send the sign-in code."
            R.string.settings_sign_in_send_code_invalid_email -> "Enter a valid email address."
            R.string.settings_sign_in_send_code_rate_limited -> "Too many sign-in attempts. Try again later."
            R.string.settings_sign_in_verify_transport_failed -> {
                "We could not verify the code right now. Check your connection and try again."
            }

            R.string.settings_sign_in_verify_failed -> "Could not verify the code."
            R.string.settings_current_workspace_new_title -> "New workspace"
            R.string.settings_loading -> "Loading..."
            R.string.settings_technical_error_title -> "Something went wrong"
            R.string.settings_server_mode_official -> "Official"
            R.string.settings_server_mode_custom -> "Custom"
            R.string.settings_server_enter_valid_url -> "Enter a valid custom server URL."
            R.string.settings_server_apply_failed -> "Could not apply custom server."
            R.string.settings_server_validate_failed -> "Custom server validation failed."
            R.string.settings_server_reset_failed -> "Could not reset the official server."
            R.string.settings_import_cloud_required -> {
                "Media ZIP import requires a linked cloud workspace in this version."
            }

            R.string.settings_import_workspace_unavailable -> {
                "Workspace is unavailable. Reload the current workspace and try again."
            }

            R.string.settings_import_preview_failed -> "Package preview failed."
            R.string.settings_import_confirm_failed -> "Package import failed."
            R.string.settings_import_preview_required -> "Preview a package before importing."
            R.string.settings_import_missing_import_tag -> "Enter an import tag."
            R.string.settings_export_package_cloud_required -> {
                "Media ZIP export requires a linked cloud workspace in this version."
            }

            R.string.settings_export_package_workspace_unavailable -> {
                "Workspace is unavailable. Reload the current workspace and try again."
            }

            R.string.settings_export_package_preview_failed -> "Package export preview failed."
            R.string.settings_export_package_download_failed -> "Package export failed."
            R.string.settings_export_package_preview_required -> "Preview this package export before saving."
            R.string.settings_export_package_summary -> "Export a Flashcards ZIP package"
            R.string.settings_logout -> "Log out"
            R.string.settings_current_workspace_create_new_title -> "Create new workspace"
            R.string.settings_current_workspace_create_new_summary -> {
                "Start a new linked workspace in the cloud"
            }

            R.string.settings_unavailable -> "Unavailable"
            R.string.settings_never -> "Never"
            R.string.settings_post_auth_upgrading_title -> "Upgrading guest account"
            R.string.settings_post_auth_linking_title -> "Linking workspace"
            R.string.settings_post_auth_recovering_local_data_title -> "Recovering local data"
            R.string.settings_post_auth_upgrading_body -> {
                "Preparing your Guest AI session for a linked Android cloud account."
            }

            R.string.settings_post_auth_linking_body -> {
                "Preparing your cloud workspace on this Android device."
            }

            R.string.settings_post_auth_recovering_local_data_body -> {
                "Keep this screen open while Android reconnects preserved local data to your recovered workspace."
            }

            R.string.settings_post_auth_guest_upgrade_failed -> "Guest account upgrade failed."
            R.string.settings_post_auth_setup_failed -> "Cloud workspace setup failed."
            R.string.settings_post_auth_syncing_title -> "Syncing workspace"
            R.string.settings_post_auth_syncing_body -> {
                "Keep this screen open while Android finishes the initial cloud sync."
            }

            R.string.settings_post_auth_signed_in_and_synced -> "Signed in and synced %1\$s."
            R.string.settings_post_auth_guest_local_recovery_failed -> {
                "Local data recovery failed. Try again; local data stays on this device."
            }

            R.string.settings_post_auth_sync_failed -> "Initial sync failed."
            R.string.settings_post_auth_linked_recovery_blocked -> {
                "Sign in with the original cloud account and workspace to reconnect preserved local data."
            }

            R.string.settings_post_auth_guest_local_recovery_required -> {
                "Guest credentials are missing on this device. Local data is preserved for recovery in a linked workspace."
            }

            R.string.settings_post_auth_pending_guest_upgrade_recovery_required -> {
                "Account upgrade recovery is pending. Reopen the app to finish recovery before signing in again."
            }

            R.string.settings_post_auth_invalid_recovery_state -> {
                "Cloud recovery data on this device is invalid. Reset cloud identity or sign in again after clearing recovery."
            }

            R.string.settings_post_auth_reset_cloud_identity_button -> "Reset cloud identity"

            R.string.settings_post_auth_invalid_recovery_state_cleared_message -> {
                "Cloud recovery state was reset. Sign in again to continue."
            }

            else -> error("Unexpected string resource id in CloudSignInViewModelTest: $stringResId")
        }
        return if (formatArgs.isEmpty()) {
            pattern
        } else {
            String.format(Locale.ENGLISH, pattern, *formatArgs)
        }
    }

    override fun getQuantity(pluralsResId: Int, quantity: Int, vararg formatArgs: Any): String {
        val pattern = when (pluralsResId) {
            R.plurals.settings_import_success -> {
                if (quantity == 1) "Imported %1\$d card." else "Imported %1\$d cards."
            }

            R.plurals.settings_import_success_with_tag -> {
                if (quantity == 1) {
                    "Imported %1\$d card with tag %2\$s."
                } else {
                    "Imported %1\$d cards with tag %2\$s."
                }
            }

            else -> error("Unexpected plurals resource id in CloudSignInViewModelTest: $pluralsResId")
        }
        return String.format(Locale.ENGLISH, pattern, *formatArgs)
    }

    override fun locale(): Locale {
        return Locale.ENGLISH
    }
}

internal class FakeSyncRepository : SyncRepository {
    private val syncErrors = ArrayDeque<Exception>()
    private val syncStatus = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )
    var syncNowCalls: Int = 0
        private set

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatus
    }

    override suspend fun scheduleSync() {
    }

    override suspend fun syncNow() {
        syncNowCalls += 1
        if (syncErrors.isNotEmpty()) {
            throw syncErrors.removeFirst()
        }
    }

    fun enqueueSyncError(error: Exception) {
        syncErrors.addLast(error)
    }
}
