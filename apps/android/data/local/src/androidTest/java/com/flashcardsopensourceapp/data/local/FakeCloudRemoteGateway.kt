package com.flashcardsopensourceapp.data.local

import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteBootstrapPushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePullResponse
import com.flashcardsopensourceapp.data.local.cloud.RemotePushOperationResult
import com.flashcardsopensourceapp.data.local.cloud.RemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryImportResponse
import com.flashcardsopensourceapp.data.local.cloud.RemoteReviewHistoryPullResponse
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeReconciliation
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject

private data class FakeCloudRemoteGatewayConfig(
    val deleteFailuresRemaining: Int,
    val fetchAccountError: Exception?,
    val guestUpgradeMode: CloudGuestUpgradeMode?,
    val guestUpgradeReconciliation: CloudGuestUpgradeReconciliation?,
    val bootstrapPullError: Exception?,
    val bootstrapRemoteIsEmptyResponses: List<Boolean>,
    val bootstrapPushErrors: List<Exception>,
    val importReviewHistoryErrors: List<Exception>,
    val createdWorkspace: CloudWorkspaceSummary,
    val onFetchCloudAccountEntered: CompletableDeferred<Unit>?,
    val blockFetchCloudAccount: CompletableDeferred<Unit>?,
    val accountSnapshot: CloudAccountSnapshot
)

internal class FakeCloudRemoteGateway private constructor(
    config: FakeCloudRemoteGatewayConfig
) : CloudRemoteGateway {
    private var deleteFailuresRemaining: Int = config.deleteFailuresRemaining
    private val fetchAccountError: Exception? = config.fetchAccountError
    private val guestUpgradeMode: CloudGuestUpgradeMode? = config.guestUpgradeMode
    private val guestUpgradeReconciliation: CloudGuestUpgradeReconciliation? = config.guestUpgradeReconciliation
    private val bootstrapPullError: Exception? = config.bootstrapPullError
    private val bootstrapRemoteIsEmptyResponses: List<Boolean> = config.bootstrapRemoteIsEmptyResponses
    private val bootstrapPushErrors: List<Exception> = config.bootstrapPushErrors
    private val importReviewHistoryErrors: List<Exception> = config.importReviewHistoryErrors
    private val createdWorkspace: CloudWorkspaceSummary = config.createdWorkspace
    private val onFetchCloudAccountEntered: CompletableDeferred<Unit>? = config.onFetchCloudAccountEntered
    private val blockFetchCloudAccount: CompletableDeferred<Unit>? = config.blockFetchCloudAccount
    private val accountSnapshot: CloudAccountSnapshot = config.accountSnapshot
    private var bootstrapPullResponseIndex: Int = 0
    private var bootstrapPushErrorIndex: Int = 0
    private var importReviewHistoryErrorIndex: Int = 0

    companion object {
        fun standard(): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forAccountDeletion(deleteFailuresRemaining: Int): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = deleteFailuresRemaining,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forFetchAccountError(fetchAccountError: Exception): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = fetchAccountError,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forAccountSnapshot(accountSnapshot: CloudAccountSnapshot): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = accountSnapshot
                )
            )
        }

        fun forBootstrapPullError(bootstrapPullError: Exception): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = bootstrapPullError,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forGuestUpgrade(
            guestUpgradeMode: CloudGuestUpgradeMode,
            accountSnapshot: CloudAccountSnapshot,
            bootstrapRemoteIsEmpty: Boolean,
            guestUpgradeReconciliation: CloudGuestUpgradeReconciliation?
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = guestUpgradeMode,
                    guestUpgradeReconciliation = guestUpgradeReconciliation,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(bootstrapRemoteIsEmpty),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = accountSnapshot
                )
            )
        }

        fun forCreatedWorkspace(
            createdWorkspace: CloudWorkspaceSummary,
            bootstrapRemoteIsEmpty: Boolean
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(bootstrapRemoteIsEmpty),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createdWorkspace,
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forBootstrapPushScenario(
            bootstrapRemoteIsEmptyResponses: List<Boolean>,
            bootstrapPushErrors: List<Exception>
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = bootstrapRemoteIsEmptyResponses,
                    bootstrapPushErrors = bootstrapPushErrors,
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forReviewHistoryImportScenario(
            bootstrapRemoteIsEmptyResponses: List<Boolean>,
            importReviewHistoryErrors: List<Exception>
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = bootstrapRemoteIsEmptyResponses,
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = importReviewHistoryErrors,
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = null,
                    blockFetchCloudAccount = null,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        fun forBlockingFetch(
            onFetchCloudAccountEntered: CompletableDeferred<Unit>,
            blockFetchCloudAccount: CompletableDeferred<Unit>
        ): FakeCloudRemoteGateway {
            return FakeCloudRemoteGateway(
                config = createConfig(
                    deleteFailuresRemaining = 0,
                    fetchAccountError = null,
                    guestUpgradeMode = null,
                    guestUpgradeReconciliation = null,
                    bootstrapPullError = null,
                    bootstrapRemoteIsEmptyResponses = listOf(true),
                    bootstrapPushErrors = emptyList(),
                    importReviewHistoryErrors = emptyList(),
                    createdWorkspace = createDefaultCreatedWorkspace(),
                    onFetchCloudAccountEntered = onFetchCloudAccountEntered,
                    blockFetchCloudAccount = blockFetchCloudAccount,
                    accountSnapshot = createDefaultAccountSnapshot()
                )
            )
        }

        private fun createConfig(
            deleteFailuresRemaining: Int,
            fetchAccountError: Exception?,
            guestUpgradeMode: CloudGuestUpgradeMode?,
            guestUpgradeReconciliation: CloudGuestUpgradeReconciliation?,
            bootstrapPullError: Exception?,
            bootstrapRemoteIsEmptyResponses: List<Boolean>,
            bootstrapPushErrors: List<Exception>,
            importReviewHistoryErrors: List<Exception>,
            createdWorkspace: CloudWorkspaceSummary,
            onFetchCloudAccountEntered: CompletableDeferred<Unit>?,
            blockFetchCloudAccount: CompletableDeferred<Unit>?,
            accountSnapshot: CloudAccountSnapshot
        ): FakeCloudRemoteGatewayConfig {
            return FakeCloudRemoteGatewayConfig(
                deleteFailuresRemaining = deleteFailuresRemaining,
                fetchAccountError = fetchAccountError,
                guestUpgradeMode = guestUpgradeMode,
                guestUpgradeReconciliation = guestUpgradeReconciliation,
                bootstrapPullError = bootstrapPullError,
                bootstrapRemoteIsEmptyResponses = bootstrapRemoteIsEmptyResponses,
                bootstrapPushErrors = bootstrapPushErrors,
                importReviewHistoryErrors = importReviewHistoryErrors,
                createdWorkspace = createdWorkspace,
                onFetchCloudAccountEntered = onFetchCloudAccountEntered,
                blockFetchCloudAccount = blockFetchCloudAccount,
                accountSnapshot = accountSnapshot
            )
        }

        private fun createDefaultCreatedWorkspace(): CloudWorkspaceSummary {
            return createCloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = "Personal",
                createdAtMillis = 300L,
                isSelected = true
            )
        }

        private fun createDefaultAccountSnapshot(): CloudAccountSnapshot {
            return createCloudAccountSnapshot(
                userId = "user-1",
                email = "user@example.com",
                workspaces = listOf(
                    createCloudWorkspaceSummary(
                        workspaceId = "workspace-remote",
                        name = localWorkspaceName,
                        createdAtMillis = 100L,
                        isSelected = true
                    )
                )
            )
        }
    }

    var deleteAccountCalls: Int = 0
    var prepareGuestUpgradeCalls: Int = 0
    var completeGuestUpgradeCalls: Int = 0
    val completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained = mutableListOf<Boolean>()
    val completeGuestUpgradeSupportsDroppedEntities = mutableListOf<Boolean>()
    var createWorkspaceCalls: Int = 0
    var selectWorkspaceCalls: Int = 0
    val renameWorkspaceIds = mutableListOf<String>()
    val syncRequestEvents = mutableListOf<String>()
    val pushBodies = mutableListOf<JSONObject>()
    val pullBodies = mutableListOf<JSONObject>()
    val pullReviewHistoryBodies = mutableListOf<JSONObject>()
    val bootstrapPullWorkspaceIds = mutableListOf<String>()
    val bootstrapPushBodies = mutableListOf<JSONObject>()
    val importReviewHistoryBodies = mutableListOf<JSONObject>()
    val createdWorkspaceId: String = createdWorkspace.workspaceId

    override suspend fun validateConfiguration(configuration: CloudServiceConfiguration) {
    }

    override suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        return CloudSendCodeResult.OtpRequired(
            challenge = createOtpChallenge(email = email)
        )
    }

    override suspend fun verifyCode(
        challenge: CloudOtpChallenge,
        code: String,
        authBaseUrl: String
    ): StoredCloudCredentials {
        return createStoredCloudCredentials(idTokenExpiresAtMillis = Long.MAX_VALUE)
    }

    override suspend fun refreshIdToken(
        refreshToken: String,
        authBaseUrl: String
    ): StoredCloudCredentials {
        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = "id-token",
            idTokenExpiresAtMillis = Long.MAX_VALUE
        )
    }

    override suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String) {
    }

    override suspend fun fetchCloudAccount(
        apiBaseUrl: String,
        bearerToken: String
    ): CloudAccountSnapshot {
        onFetchCloudAccountEntered?.complete(Unit)
        blockFetchCloudAccount?.await()
        fetchAccountError?.let { error ->
            throw error
        }
        return accountSnapshot
    }

    override suspend fun listLinkedWorkspaces(
        apiBaseUrl: String,
        bearerToken: String
    ): List<CloudWorkspaceSummary> {
        return fetchCloudAccount(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken).workspaces
    }

    override suspend fun prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ): CloudGuestUpgradeMode {
        prepareGuestUpgradeCalls += 1
        return requireNotNull(guestUpgradeMode) {
            "Guest upgrade mode is required for this test."
        }
    }

    override suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection,
        guestWorkspaceSyncedAndOutboxDrained: Boolean,
        supportsDroppedEntities: Boolean
    ): CloudGuestUpgradeCompletion {
        completeGuestUpgradeCalls += 1
        completeGuestUpgradeGuestWorkspaceSyncedAndOutboxDrained += guestWorkspaceSyncedAndOutboxDrained
        completeGuestUpgradeSupportsDroppedEntities += supportsDroppedEntities
        return CloudGuestUpgradeCompletion(
            workspace = resolveWorkspaceSelection(selection = selection),
            reconciliation = guestUpgradeReconciliation
        )
    }

    override suspend fun createWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        name: String
    ): CloudWorkspaceSummary {
        createWorkspaceCalls += 1
        return createdWorkspace.copy(name = name)
    }

    override suspend fun selectWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceSummary {
        selectWorkspaceCalls += 1
        return accountSnapshot.workspaces.first { workspace ->
            workspace.workspaceId == workspaceId
        }
    }

    override suspend fun renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ): CloudWorkspaceSummary {
        renameWorkspaceIds += workspaceId
        return CloudWorkspaceSummary(
            workspaceId = workspaceId,
            name = name,
            createdAtMillis = createdWorkspace.createdAtMillis,
            isSelected = true
        )
    }

    override suspend fun loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceDeletePreview {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview {
        throw UnsupportedOperationException()
    }

    override suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary {
        throw UnsupportedOperationException()
    }

    override suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        throw UnsupportedOperationException()
    }

    override suspend fun deleteAccount(
        apiBaseUrl: String,
        bearerToken: String,
        confirmationText: String
    ) {
        deleteAccountCalls += 1
        if (deleteFailuresRemaining > 0) {
            deleteFailuresRemaining -= 1
            throw IllegalStateException("Delete request did not finish.")
        }
    }

    override suspend fun listAgentConnections(
        apiBaseUrl: String,
        bearerToken: String
    ): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        throw UnsupportedOperationException()
    }

    override suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse {
        syncRequestEvents += "push"
        pushBodies += JSONObject(body.toString())
        val operations = body.getJSONArray("operations")
        return RemotePushResponse(
            operations = List(operations.length()) { index ->
                RemotePushOperationResult(
                    operationId = operations.getJSONObject(index).getString("operationId"),
                    resultingHotChangeId = 100L + index
                )
            }
        )
    }

    override suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse {
        syncRequestEvents += "pull"
        pullBodies += JSONObject(body.toString())
        return RemotePullResponse(changes = emptyList(), nextHotChangeId = 0L, hasMore = false)
    }

    override suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        bootstrapPullError?.let { error ->
            throw error
        }
        syncRequestEvents += "bootstrap_pull"
        bootstrapPullWorkspaceIds += workspaceId
        return RemoteBootstrapPullResponse(
            entries = emptyList(),
            nextCursor = null,
            hasMore = false,
            bootstrapHotChangeId = 0L,
            remoteIsEmpty = nextBootstrapRemoteIsEmpty()
        )
    }

    override suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        syncRequestEvents += "bootstrap_push"
        bootstrapPushBodies += JSONObject(body.toString())
        nextBootstrapPushErrorOrNull()?.let { error ->
            throw error
        }
        return RemoteBootstrapPushResponse(
            appliedEntriesCount = 0,
            bootstrapHotChangeId = 0L
        )
    }

    override suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse {
        syncRequestEvents += "pull_review_history"
        pullReviewHistoryBodies += JSONObject(body.toString())
        return RemoteReviewHistoryPullResponse(
            reviewEvents = emptyList(),
            nextReviewSequenceId = 0L,
            hasMore = false
        )
    }

    override suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
        syncRequestEvents += "import_review_history"
        importReviewHistoryBodies += JSONObject(body.toString())
        nextImportReviewHistoryErrorOrNull()?.let { error ->
            throw error
        }
        return RemoteReviewHistoryImportResponse(
            importedCount = 0,
            duplicateCount = 0,
            nextReviewSequenceId = 0L
        )
    }

    private fun resolveWorkspaceSelection(selection: CloudGuestUpgradeSelection): CloudWorkspaceSummary {
        return when (selection) {
            is CloudGuestUpgradeSelection.Existing -> accountSnapshot.workspaces.first { workspace ->
                workspace.workspaceId == selection.workspaceId
            }

            CloudGuestUpgradeSelection.CreateNew -> createCloudWorkspaceSummary(
                workspaceId = "workspace-new",
                name = localWorkspaceName,
                createdAtMillis = 300L,
                isSelected = true
            )
        }
    }

    private fun nextBootstrapRemoteIsEmpty(): Boolean {
        val response = bootstrapRemoteIsEmptyResponses.getOrElse(bootstrapPullResponseIndex) {
            bootstrapRemoteIsEmptyResponses.lastOrNull() ?: true
        }
        bootstrapPullResponseIndex += 1
        return response
    }

    private fun nextBootstrapPushErrorOrNull(): Exception? {
        if (bootstrapPushErrorIndex >= bootstrapPushErrors.size) {
            return null
        }
        val error = bootstrapPushErrors[bootstrapPushErrorIndex]
        bootstrapPushErrorIndex += 1
        return error
    }

    private fun nextImportReviewHistoryErrorOrNull(): Exception? {
        if (importReviewHistoryErrorIndex >= importReviewHistoryErrors.size) {
            return null
        }
        val error = importReviewHistoryErrors[importReviewHistoryErrorIndex]
        importReviewHistoryErrorIndex += 1
        return error
    }
}
