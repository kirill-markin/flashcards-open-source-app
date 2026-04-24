package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
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
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.makeIdTokenExpiryTimestampMillis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/*
 Keep Android sync wire payloads aligned with:
 - apps/backend/src/sync.ts
 - apps/ios/Flashcards/Flashcards/CloudSync/CloudSyncContracts.swift
 */

data class RemoteSyncChange(
    val changeId: Long,
    val entityType: SyncEntityType,
    val entityId: String,
    val action: String,
    val payload: JSONObject
)

data class RemoteBootstrapEntry(
    val entityType: SyncEntityType,
    val entityId: String,
    val action: String,
    val payload: JSONObject
)

data class RemotePullResponse(
    val changes: List<RemoteSyncChange>,
    val nextHotChangeId: Long,
    val hasMore: Boolean
)

data class RemoteBootstrapPullResponse(
    val entries: List<RemoteBootstrapEntry>,
    val nextCursor: String?,
    val hasMore: Boolean,
    val bootstrapHotChangeId: Long,
    val remoteIsEmpty: Boolean
)

data class RemoteBootstrapPushResponse(
    val appliedEntriesCount: Int,
    val bootstrapHotChangeId: Long?
)

data class RemoteReviewHistoryEvent(
    val reviewEventId: String,
    val workspaceId: String,
    val cardId: String,
    val replicaId: String,
    val clientEventId: String,
    val rating: Int,
    val reviewedAtClient: String,
    val reviewedAtServer: String
)

data class RemoteReviewHistoryPullResponse(
    val reviewEvents: List<RemoteReviewHistoryEvent>,
    val nextReviewSequenceId: Long,
    val hasMore: Boolean
)

data class RemoteReviewHistoryImportResponse(
    val importedCount: Int,
    val duplicateCount: Int,
    val nextReviewSequenceId: Long?
)

data class RemotePushOperationResult(
    val operationId: String,
    val resultingHotChangeId: Long?
)

data class RemotePushResponse(
    val operations: List<RemotePushOperationResult>
)

data class CloudSyncConflictDetails(
    val conflictingWorkspaceId: String?,
    val remoteIsEmpty: Boolean?
)

class CloudRemoteException(
    message: String,
    val statusCode: Int?,
    val responseBody: String?,
    val errorCode: String?,
    val requestId: String?,
    val syncConflict: CloudSyncConflictDetails?
) : Exception(message)

internal data class ParsedCloudErrorPayload(
    val message: String?,
    val code: String?,
    val requestId: String?,
    val syncConflict: CloudSyncConflictDetails?
)

interface CloudRemoteGateway {
    suspend fun validateConfiguration(configuration: CloudServiceConfiguration)
    suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult
    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials
    suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials
    suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String)
    suspend fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot
    suspend fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary>
    suspend fun prepareGuestUpgrade(apiBaseUrl: String, bearerToken: String, guestToken: String): CloudGuestUpgradeMode
    suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection
    ): CloudWorkspaceSummary

    suspend fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary
    suspend fun selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceSummary
    suspend fun renameWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String, name: String): CloudWorkspaceSummary
    suspend fun loadWorkspaceDeletePreview(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceDeletePreview
    suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult
    suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview
    suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult
    suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary
    suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries

    suspend fun deleteAccount(apiBaseUrl: String, bearerToken: String, confirmationText: String)
    suspend fun listAgentConnections(apiBaseUrl: String, bearerToken: String): AgentApiKeyConnectionsResult
    suspend fun revokeAgentConnection(apiBaseUrl: String, bearerToken: String, connectionId: String): AgentApiKeyConnectionsResult
    suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse
    suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse
    suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse

    suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse

    suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse

    suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse
}

class CloudRemoteService : CloudRemoteGateway {
    override
    suspend fun validateConfiguration(configuration: CloudServiceConfiguration) {
        getJson(
            baseUrl = configuration.authBaseUrl,
            path = "/health",
            authorizationHeader = null
        )
        getJson(
            baseUrl = configuration.apiBaseUrl,
            path = "/health",
            authorizationHeader = null
        )
    }

    override
    suspend fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        val response = postJson(
            baseUrl = authBaseUrl,
            path = "/api/send-code",
            body = JSONObject().put("email", email.trim().lowercase())
        )
        require(response.requireCloudBoolean("ok", "sendCode.ok")) {
            "Cloud send-code did not return ok=true."
        }

        val idToken = response.optCloudStringOrNull("idToken", "sendCode.idToken")
        val refreshToken = response.optCloudStringOrNull("refreshToken", "sendCode.refreshToken")
        val expiresIn = response.optCloudIntOrNull("expiresIn", "sendCode.expiresIn")
        if (idToken != null && refreshToken != null && expiresIn != null && expiresIn > 0) {
            return CloudSendCodeResult.Verified(
                credentials = StoredCloudCredentials(
                    refreshToken = refreshToken,
                    idToken = idToken,
                    idTokenExpiresAtMillis = makeIdTokenExpiryTimestampMillis(
                        nowMillis = System.currentTimeMillis(),
                        expiresInSeconds = expiresIn
                    )
                )
            )
        }

        val csrfToken = response.requireCloudString("csrfToken", "sendCode.csrfToken")
        val otpSessionToken = response.requireCloudString("otpSessionToken", "sendCode.otpSessionToken")
        require(csrfToken.isNotBlank()) {
            "Cloud send-code response is missing csrfToken."
        }
        require(otpSessionToken.isNotBlank()) {
            "Cloud send-code response is missing otpSessionToken."
        }

        return CloudSendCodeResult.OtpRequired(
            challenge = CloudOtpChallenge(
                email = email.trim().lowercase(),
                csrfToken = csrfToken,
                otpSessionToken = otpSessionToken
            )
        )
    }

    override
    suspend fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials {
        val response = postJson(
            baseUrl = authBaseUrl,
            path = "/api/verify-code",
            body = JSONObject()
                .put("code", code.trim())
                .put("csrfToken", challenge.csrfToken)
                .put("otpSessionToken", challenge.otpSessionToken)
        )
        require(response.requireCloudBoolean("ok", "verifyCode.ok")) {
            "Cloud verify-code did not return ok=true."
        }

        val refreshToken = response.requireCloudString("refreshToken", "verifyCode.refreshToken")
        val idToken = response.requireCloudString("idToken", "verifyCode.idToken")
        val expiresIn = response.requireCloudInt("expiresIn", "verifyCode.expiresIn")
        require(refreshToken.isNotBlank()) {
            "Cloud verify-code response is missing refreshToken."
        }
        require(idToken.isNotBlank()) {
            "Cloud verify-code response is missing idToken."
        }
        require(expiresIn > 0) {
            "Cloud verify-code response is missing expiresIn."
        }

        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            idTokenExpiresAtMillis = makeIdTokenExpiryTimestampMillis(
                nowMillis = System.currentTimeMillis(),
                expiresInSeconds = expiresIn
            )
        )
    }

    override
    suspend fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials {
        val response = postJson(
            baseUrl = authBaseUrl,
            path = "/api/refresh-token",
            body = JSONObject().put("refreshToken", refreshToken)
        )
        require(response.requireCloudBoolean("ok", "refreshToken.ok")) {
            "Cloud refresh-token did not return ok=true."
        }

        val idToken = response.requireCloudString("idToken", "refreshToken.idToken")
        val expiresIn = response.requireCloudInt("expiresIn", "refreshToken.expiresIn")
        require(idToken.isNotBlank()) {
            "Cloud refresh-token response is missing idToken."
        }
        require(expiresIn > 0) {
            "Cloud refresh-token response is missing expiresIn."
        }

        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            idTokenExpiresAtMillis = makeIdTokenExpiryTimestampMillis(
                nowMillis = System.currentTimeMillis(),
                expiresInSeconds = expiresIn
            )
        )
    }

    override
    suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String) {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/guest-auth/session/delete",
            authorizationHeader = "Guest $guestToken",
            body = null
        )
        require(response.requireCloudBoolean("ok", "deleteGuestSession.ok")) {
            "Cloud delete-guest-session did not return ok=true."
        }
    }

    override
    suspend fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot {
        val meResponse = getJson(apiBaseUrl, "/me", authorizationHeader = "Bearer $bearerToken")
        val selectedWorkspaceId = meResponse.requireCloudNullableString("selectedWorkspaceId", "me.selectedWorkspaceId")
        val profile = meResponse.requireCloudObject("profile", "me.profile")
        val workspacesResponse = getJson(apiBaseUrl, buildPaginatedPath("/workspaces", null), "Bearer $bearerToken")
        val workspaces = mutableListOf<CloudWorkspaceSummary>()
        appendWorkspacePage(workspaces, workspacesResponse, selectedWorkspaceId)

        var nextCursor = workspacesResponse.requireCloudNullableString("nextCursor", "workspaces.nextCursor")
        while (nextCursor != null) {
            val nextPage = getJson(
                apiBaseUrl,
                buildPaginatedPath("/workspaces", nextCursor),
                "Bearer $bearerToken"
            )
            appendWorkspacePage(workspaces, nextPage, selectedWorkspaceId)
            nextCursor = nextPage.requireCloudNullableString("nextCursor", "workspaces.nextCursor")
        }

        return CloudAccountSnapshot(
            userId = meResponse.requireCloudString("userId", "me.userId"),
            email = profile.requireCloudNullableString("email", "me.profile.email"),
            workspaces = workspaces
        )
    }

    override
    suspend fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary> {
        return fetchCloudAccount(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken).workspaces
    }

    override
    suspend fun prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ): CloudGuestUpgradeMode {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/guest-auth/upgrade/prepare",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("guestToken", guestToken)
        )
        return parseGuestUpgradeMode(
            rawMode = response.requireCloudString("mode", "guestUpgradePrepare.mode"),
            fieldPath = "guestUpgradePrepare.mode"
        )
    }

    override
    suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection
    ): CloudWorkspaceSummary {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/guest-auth/upgrade/complete",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject()
                .put("guestToken", guestToken)
                .put("selection", encodeGuestUpgradeSelection(selection = selection))
        )
        return parseWorkspace(
            workspace = response.requireCloudObject("workspace", "guestUpgradeComplete.workspace"),
            isSelected = true,
            fieldPath = "guestUpgradeComplete.workspace"
        )
    }

    override
    suspend fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("name", name)
        )
        return parseWorkspace(
            workspace = response.requireCloudObject("workspace", "createWorkspace.workspace"),
            isSelected = true,
            fieldPath = "createWorkspace.workspace"
        )
    }

    override
    suspend fun selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceSummary {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/select",
            authorizationHeader = "Bearer $bearerToken",
            body = null
        )
        return parseWorkspace(
            workspace = response.requireCloudObject("workspace", "selectWorkspace.workspace"),
            isSelected = true,
            fieldPath = "selectWorkspace.workspace"
        )
    }

    override
    suspend fun renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ): CloudWorkspaceSummary {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/rename",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("name", name)
        )
        return parseWorkspace(
            workspace = response.requireCloudObject("workspace", "renameWorkspace.workspace"),
            isSelected = true,
            fieldPath = "renameWorkspace.workspace"
        )
    }

    override
    suspend fun loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceDeletePreview {
        val response = getJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/delete-preview",
            authorizationHeader = "Bearer $bearerToken"
        )
        return CloudWorkspaceDeletePreview(
            workspaceId = response.requireCloudString("workspaceId", "workspaceDeletePreview.workspaceId"),
            workspaceName = response.requireCloudString("workspaceName", "workspaceDeletePreview.workspaceName"),
            activeCardCount = response.requireCloudInt("activeCardCount", "workspaceDeletePreview.activeCardCount"),
            confirmationText = response.requireCloudString("confirmationText", "workspaceDeletePreview.confirmationText"),
            isLastAccessibleWorkspace = response.requireCloudBoolean(
                "isLastAccessibleWorkspace",
                "workspaceDeletePreview.isLastAccessibleWorkspace"
            )
        )
    }

    override
    suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/delete",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("confirmationText", confirmationText)
        )
        return CloudWorkspaceDeleteResult(
            ok = response.requireCloudBoolean("ok", "deleteWorkspace.ok"),
            deletedWorkspaceId = response.requireCloudString("deletedWorkspaceId", "deleteWorkspace.deletedWorkspaceId"),
            deletedCardsCount = response.requireCloudInt("deletedCardsCount", "deleteWorkspace.deletedCardsCount"),
            workspace = parseWorkspace(
                workspace = response.requireCloudObject("workspace", "deleteWorkspace.workspace"),
                isSelected = true,
                fieldPath = "deleteWorkspace.workspace"
            )
        )
    }

    override
    suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview {
        val response = getJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/reset-progress-preview",
            authorizationHeader = "Bearer $bearerToken"
        )
        return CloudWorkspaceResetProgressPreview(
            workspaceId = response.requireCloudString("workspaceId", "workspaceResetProgressPreview.workspaceId"),
            workspaceName = response.requireCloudString("workspaceName", "workspaceResetProgressPreview.workspaceName"),
            cardsToResetCount = response.requireCloudInt(
                "cardsToResetCount",
                "workspaceResetProgressPreview.cardsToResetCount"
            ),
            confirmationText = response.requireCloudString(
                "confirmationText",
                "workspaceResetProgressPreview.confirmationText"
            )
        )
    }

    override
    suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/reset-progress",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("confirmationText", confirmationText)
        )
        return CloudWorkspaceResetProgressResult(
            ok = response.requireCloudBoolean("ok", "resetWorkspaceProgress.ok"),
            workspaceId = response.requireCloudString("workspaceId", "resetWorkspaceProgress.workspaceId"),
            cardsResetCount = response.requireCloudInt("cardsResetCount", "resetWorkspaceProgress.cardsResetCount")
        )
    }

    override
    suspend fun loadProgressSummary(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String
    ): CloudProgressSummary {
        val response = getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressSummaryPath(timeZone = timeZone),
            authorizationHeader = authorizationHeader
        )
        return parseCloudProgressSummaryResponse(
            response = response,
            fieldPath = "progressSummary"
        )
    }

    override
    suspend fun loadProgressSeries(
        apiBaseUrl: String,
        authorizationHeader: String,
        timeZone: String,
        from: String,
        to: String
    ): CloudProgressSeries {
        val response = getJson(
            baseUrl = apiBaseUrl,
            path = buildProgressSeriesPath(
                timeZone = timeZone,
                from = from,
                to = to
            ),
            authorizationHeader = authorizationHeader
        )
        val dailyReviews = response.requireCloudArray("dailyReviews", "progress.dailyReviews")

        return CloudProgressSeries(
            timeZone = response.requireCloudString("timeZone", "progress.timeZone"),
            from = response.requireCloudString("from", "progress.from"),
            to = response.requireCloudString("to", "progress.to"),
            dailyReviews = buildList {
                for (index in 0 until dailyReviews.length()) {
                    val point = dailyReviews.requireCloudObject(index, "progress.dailyReviews[$index]")
                    add(
                        CloudDailyReviewPoint(
                            date = point.requireCloudString("date", "progress.dailyReviews[$index].date"),
                            reviewCount = point.requireCloudInt(
                                "reviewCount",
                                "progress.dailyReviews[$index].reviewCount"
                            )
                        )
                    )
                }
            },
            generatedAt = response.optCloudStringOrNull("generatedAt", "progress.generatedAt"),
            summary = null
        )
    }

    override
    suspend fun deleteAccount(
        apiBaseUrl: String,
        bearerToken: String,
        confirmationText: String
    ) {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/me/delete",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("confirmationText", confirmationText)
        )
        require(response.requireCloudBoolean("ok", "deleteAccount.ok")) {
            "Cloud delete-account did not return ok=true."
        }
    }

    private fun encodeGuestUpgradeSelection(selection: CloudGuestUpgradeSelection): JSONObject {
        return when (selection) {
            is CloudGuestUpgradeSelection.Existing -> JSONObject()
                .put("type", "existing")
                .put("workspaceId", selection.workspaceId)

            CloudGuestUpgradeSelection.CreateNew -> JSONObject()
                .put("type", "create_new")
        }
    }

    private fun parseGuestUpgradeMode(rawMode: String, fieldPath: String): CloudGuestUpgradeMode {
        return when (rawMode) {
            "bound" -> CloudGuestUpgradeMode.BOUND
            "merge_required" -> CloudGuestUpgradeMode.MERGE_REQUIRED
            else -> {
                throw CloudContractMismatchException(
                    "Cloud contract mismatch for $fieldPath: expected one of [bound, merge_required], got invalid string \"$rawMode\""
                )
            }
        }
    }

    override
    suspend fun listAgentConnections(apiBaseUrl: String, bearerToken: String): AgentApiKeyConnectionsResult {
        val connections = mutableListOf<AgentApiKeyConnection>()
        var nextCursor: String? = null
        var instructions: String = ""

        do {
            val response = getJson(
                baseUrl = apiBaseUrl,
                path = buildPaginatedPath(basePath = "/agent-api-keys", cursor = nextCursor),
                authorizationHeader = "Bearer $bearerToken"
            )
            instructions = response.requireCloudString("instructions", "agentApiKeys.instructions")
            val items = response.requireCloudArray("connections", "agentApiKeys.connections")
            for (index in 0 until items.length()) {
                connections.add(
                    parseAgentApiKeyConnection(
                        connection = items.requireCloudObject(index, "agentApiKeys.connections[$index]"),
                        fieldPath = "agentApiKeys.connections[$index]"
                    )
                )
            }
            nextCursor = response.requireCloudNullableString("nextCursor", "agentApiKeys.nextCursor")
        } while (nextCursor != null)

        return AgentApiKeyConnectionsResult(
            connections = connections,
            instructions = instructions
        )
    }

    override
    suspend fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/agent-api-keys/$connectionId/revoke",
            authorizationHeader = "Bearer $bearerToken",
            body = null
        )
        return AgentApiKeyConnectionsResult(
            connections = listOf(
                parseAgentApiKeyConnection(
                    connection = response.requireCloudObject("connection", "revokeAgentConnection.connection"),
                    fieldPath = "revokeAgentConnection.connection"
                )
            ),
            instructions = response.requireCloudString("instructions", "revokeAgentConnection.instructions")
        )
    }

    override
    suspend fun push(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePushResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/push",
            authorizationHeader = authorizationHeader,
            body = body
        )
        val operations = response.requireCloudArray("operations", "push.operations")
        return RemotePushResponse(
            operations = buildList {
                for (index in 0 until operations.length()) {
                    val entry = operations.requireCloudObject(index, "push.operations[$index]")
                    val status = entry.requireCloudString("status", "push.operations[$index].status")
                    if (status != "applied" && status != "ignored" && status != "duplicate") {
                        throw CloudRemoteException(
                            message = "Cloud push failed for operation ${entry.requireCloudString("operationId", "push.operations[$index].operationId")}: ${entry.optCloudStringOrNull("error", "push.operations[$index].error").orEmpty()}",
                            statusCode = 200,
                            responseBody = response.toString(),
                            errorCode = null,
                            requestId = null,
                            syncConflict = null
                        )
                    }
                    add(
                        RemotePushOperationResult(
                            operationId = entry.requireCloudString("operationId", "push.operations[$index].operationId"),
                            resultingHotChangeId = entry.optCloudLongOrNull(
                                "resultingHotChangeId",
                                "push.operations[$index].resultingHotChangeId"
                            )
                        )
                    )
                }
            }
        )
    }

    override
    suspend fun pull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemotePullResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/pull",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemotePullResponse(
            changes = parseHotChanges(response.requireCloudArray("changes", "pull.changes")),
            nextHotChangeId = response.requireCloudLong("nextHotChangeId", "pull.nextHotChangeId"),
            hasMore = response.requireCloudBoolean("hasMore", "pull.hasMore")
        )
    }

    override
    suspend fun bootstrapPull(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/bootstrap",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteBootstrapPullResponse(
            entries = parseBootstrapEntries(response.requireCloudArray("entries", "bootstrap.entries")),
            nextCursor = response.requireCloudNullableString("nextCursor", "bootstrap.nextCursor"),
            hasMore = response.requireCloudBoolean("hasMore", "bootstrap.hasMore"),
            bootstrapHotChangeId = response.requireCloudLong("bootstrapHotChangeId", "bootstrap.bootstrapHotChangeId"),
            remoteIsEmpty = response.requireCloudBoolean("remoteIsEmpty", "bootstrap.remoteIsEmpty")
        )
    }

    override
    suspend fun bootstrapPush(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/bootstrap",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteBootstrapPushResponse(
            appliedEntriesCount = response.requireCloudInt("appliedEntriesCount", "bootstrapPush.appliedEntriesCount"),
            bootstrapHotChangeId = response.optCloudLongOrNull("bootstrapHotChangeId", "bootstrapPush.bootstrapHotChangeId")
        )
    }

    override
    suspend fun pullReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/review-history/pull",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteReviewHistoryPullResponse(
            reviewEvents = parseReviewHistoryEvents(response.requireCloudArray("reviewEvents", "reviewHistoryPull.reviewEvents")),
            nextReviewSequenceId = response.requireCloudLong("nextReviewSequenceId", "reviewHistoryPull.nextReviewSequenceId"),
            hasMore = response.requireCloudBoolean("hasMore", "reviewHistoryPull.hasMore")
        )
    }

    override
    suspend fun importReviewHistory(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/review-history/import",
            authorizationHeader = authorizationHeader,
            body = body
        )

        return RemoteReviewHistoryImportResponse(
            importedCount = response.requireCloudInt("importedCount", "reviewHistoryImport.importedCount"),
            duplicateCount = response.requireCloudInt("duplicateCount", "reviewHistoryImport.duplicateCount"),
            nextReviewSequenceId = response.optCloudLongOrNull("nextReviewSequenceId", "reviewHistoryImport.nextReviewSequenceId")
        )
    }

    private fun appendWorkspacePage(
        workspaces: MutableList<CloudWorkspaceSummary>,
        response: JSONObject,
        selectedWorkspaceId: String?
    ) {
        val items = response.requireCloudArray("workspaces", "workspaces.workspaces")
        for (index in 0 until items.length()) {
            val workspace = items.requireCloudObject(index, "workspaces.workspaces[$index]")
            workspaces.add(
                parseWorkspace(
                    workspace = workspace,
                    isSelected = workspace.requireCloudString("workspaceId", "workspaces.workspaces[$index].workspaceId") == selectedWorkspaceId,
                    fieldPath = "workspaces.workspaces[$index]"
                )
            )
        }
    }

    private fun parseWorkspace(
        workspace: JSONObject,
        isSelected: Boolean,
        fieldPath: String
    ): CloudWorkspaceSummary {
        return CloudWorkspaceSummary(
            workspaceId = workspace.requireCloudString("workspaceId", "$fieldPath.workspaceId"),
            name = workspace.requireCloudString("name", "$fieldPath.name"),
            createdAtMillis = workspace.requireCloudIsoTimestampMillis("createdAt", "$fieldPath.createdAt"),
            isSelected = isSelected
        )
    }

    private fun parseAgentApiKeyConnection(
        connection: JSONObject,
        fieldPath: String
    ): AgentApiKeyConnection {
        return AgentApiKeyConnection(
            connectionId = connection.requireCloudString("connectionId", "$fieldPath.connectionId"),
            label = connection.requireCloudString("label", "$fieldPath.label"),
            createdAtMillis = connection.requireCloudIsoTimestampMillis("createdAt", "$fieldPath.createdAt"),
            lastUsedAtMillis = connection.requireCloudNullableIsoTimestampMillis("lastUsedAt", "$fieldPath.lastUsedAt"),
            revokedAtMillis = connection.requireCloudNullableIsoTimestampMillis("revokedAt", "$fieldPath.revokedAt")
        )
    }

    private fun parseHotChanges(changes: JSONArray): List<RemoteSyncChange> {
        return buildList {
            for (index in 0 until changes.length()) {
                val change = changes.requireCloudObject(index, "pull.changes[$index]")
                add(
                    RemoteSyncChange(
                        changeId = change.requireCloudLong("changeId", "pull.changes[$index].changeId"),
                        entityType = parseSyncEntityType(
                            rawValue = change.requireCloudString("entityType", "pull.changes[$index].entityType"),
                            fieldPath = "pull.changes[$index].entityType"
                        ),
                        entityId = change.requireCloudString("entityId", "pull.changes[$index].entityId"),
                        action = change.requireCloudString("action", "pull.changes[$index].action"),
                        payload = change.requireCloudObject("payload", "pull.changes[$index].payload")
                    )
                )
            }
        }
    }

    private fun parseBootstrapEntries(entries: JSONArray): List<RemoteBootstrapEntry> {
        return buildList {
            for (index in 0 until entries.length()) {
                val entry = entries.requireCloudObject(index, "bootstrap.entries[$index]")
                add(
                    RemoteBootstrapEntry(
                        entityType = parseSyncEntityType(
                            rawValue = entry.requireCloudString("entityType", "bootstrap.entries[$index].entityType"),
                            fieldPath = "bootstrap.entries[$index].entityType"
                        ),
                        entityId = entry.requireCloudString("entityId", "bootstrap.entries[$index].entityId"),
                        action = entry.requireCloudString("action", "bootstrap.entries[$index].action"),
                        payload = entry.requireCloudObject("payload", "bootstrap.entries[$index].payload")
                    )
                )
            }
        }
    }

    private fun parseReviewHistoryEvents(events: JSONArray): List<RemoteReviewHistoryEvent> {
        return buildList {
            for (index in 0 until events.length()) {
                val event = events.requireCloudObject(index, "reviewHistoryPull.reviewEvents[$index]")
                add(
                    RemoteReviewHistoryEvent(
                        reviewEventId = event.requireCloudString(
                            "reviewEventId",
                            "reviewHistoryPull.reviewEvents[$index].reviewEventId"
                        ),
                        workspaceId = event.requireCloudString(
                            "workspaceId",
                            "reviewHistoryPull.reviewEvents[$index].workspaceId"
                        ),
                        cardId = event.requireCloudString("cardId", "reviewHistoryPull.reviewEvents[$index].cardId"),
                        replicaId = event.requireCloudString("replicaId", "reviewHistoryPull.reviewEvents[$index].replicaId"),
                        clientEventId = event.requireCloudString(
                            "clientEventId",
                            "reviewHistoryPull.reviewEvents[$index].clientEventId"
                        ),
                        rating = event.requireCloudInt("rating", "reviewHistoryPull.reviewEvents[$index].rating"),
                        reviewedAtClient = event.requireCloudString(
                            "reviewedAtClient",
                            "reviewHistoryPull.reviewEvents[$index].reviewedAtClient"
                        ),
                        reviewedAtServer = event.requireCloudString(
                            "reviewedAtServer",
                            "reviewHistoryPull.reviewEvents[$index].reviewedAtServer"
                        )
                    )
                )
            }
        }
    }

    private fun parseSyncEntityType(rawValue: String, fieldPath: String): SyncEntityType {
        return when (rawValue) {
            "card" -> SyncEntityType.CARD
            "deck" -> SyncEntityType.DECK
            "workspace_scheduler_settings" -> SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS
            "review_event" -> SyncEntityType.REVIEW_EVENT
            else -> throw CloudContractMismatchException(
                "Cloud contract mismatch for $fieldPath: expected one of [card, deck, workspace_scheduler_settings, review_event], got invalid string \"$rawValue\""
            )
        }
    }

    private fun buildPaginatedPath(basePath: String, cursor: String?): String {
        val query = if (cursor == null) {
            "limit=100"
        } else {
            "limit=100&cursor=${URLEncoder.encode(cursor, StandardCharsets.UTF_8)}"
        }
        return "$basePath?$query"
    }

    private fun buildProgressSummaryPath(
        timeZone: String
    ): String {
        return buildString {
            append("/me/progress/summary?timeZone=")
            append(URLEncoder.encode(timeZone, StandardCharsets.UTF_8))
        }
    }

    private fun buildProgressSeriesPath(
        timeZone: String,
        from: String,
        to: String
    ): String {
        return buildString {
            append("/me/progress/series?timeZone=")
            append(URLEncoder.encode(timeZone, StandardCharsets.UTF_8))
            append("&from=")
            append(URLEncoder.encode(from, StandardCharsets.UTF_8))
            append("&to=")
            append(URLEncoder.encode(to, StandardCharsets.UTF_8))
        }
    }

    internal fun parseCloudProgressSummaryResponse(
        response: JSONObject,
        fieldPath: String
    ): CloudProgressSummary {
        return response.requireCloudObject("summary", "$fieldPath.summary").toCloudProgressSummary(
            fieldPath = "$fieldPath.summary"
        )
    }

    private fun JSONObject.toCloudProgressSummary(
        fieldPath: String
    ): CloudProgressSummary {
        return CloudProgressSummary(
            currentStreakDays = requireCloudInt("currentStreakDays", "$fieldPath.currentStreakDays"),
            hasReviewedToday = requireCloudBoolean("hasReviewedToday", "$fieldPath.hasReviewedToday"),
            lastReviewedOn = requireCloudNullableString("lastReviewedOn", "$fieldPath.lastReviewedOn"),
            activeReviewDays = requireCloudInt("activeReviewDays", "$fieldPath.activeReviewDays")
        )
    }

    private suspend fun getJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?
    ): JSONObject {
        return executeJsonRequest(
            baseUrl = baseUrl,
            path = path,
            method = "GET",
            authorizationHeader = authorizationHeader,
            body = null
        )
    }

    private suspend fun postJson(
        baseUrl: String,
        path: String,
        body: JSONObject?,
        authorizationHeader: String? = null
    ): JSONObject {
        return executeJsonRequest(
            baseUrl = baseUrl,
            path = path,
            method = "POST",
            authorizationHeader = authorizationHeader,
            body = body
        )
    }

    private suspend fun executeJsonRequest(
        baseUrl: String,
        path: String,
        method: String,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject = withContext(Dispatchers.IO) {
        val normalizedBaseUrl = if (baseUrl.endsWith("/")) {
            baseUrl.dropLast(1)
        } else {
            baseUrl
        }
        val connection = (URL("$normalizedBaseUrl$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            doInput = true
            setRequestProperty("Content-Type", "application/json")
            if (authorizationHeader != null) {
                setRequestProperty("Authorization", authorizationHeader)
            }
            if (body != null) {
                doOutput = true
                outputStream.use { output ->
                    output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
                }
            }
        }

        try {
            val statusCode = connection.responseCode
            val responseBody = readConnectionBody(connection = connection, useErrorStream = statusCode >= 400)
            if (statusCode < 200 || statusCode >= 300) {
                val parsedError = parseCloudErrorPayload(responseBody = responseBody)
                throw CloudRemoteException(
                    message = formatCloudRemoteErrorMessage(
                        statusCode = statusCode,
                        path = path,
                        parsedError = parsedError,
                        responseBody = responseBody
                    ),
                    statusCode = statusCode,
                    responseBody = responseBody,
                    errorCode = parsedError?.code,
                    requestId = parsedError?.requestId,
                    syncConflict = parsedError?.syncConflict
                )
            }

            if (responseBody.isBlank()) {
                JSONObject()
            } else {
                JSONObject(responseBody)
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun readConnectionBody(connection: HttpURLConnection, useErrorStream: Boolean): String {
        val inputStream = if (useErrorStream) {
            connection.errorStream
        } else {
            connection.inputStream
        } ?: return ""

        return inputStream.use { stream ->
            BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { reader ->
                reader.readText()
            }
        }
    }
}

private fun formatCloudRemoteErrorMessage(
    statusCode: Int,
    path: String,
    parsedError: ParsedCloudErrorPayload?,
    responseBody: String
): String {
    val message = parsedError?.message?.trim().orEmpty()
    if (message.isNotEmpty()) {
        val requestId = parsedError?.requestId?.trim().orEmpty()
        return if (requestId.isEmpty()) {
            message
        } else {
            "$message Reference: $requestId"
        }
    }

    return if (responseBody.isBlank()) {
        "Cloud request failed with status $statusCode for $path."
    } else {
        "Cloud request failed with status $statusCode for $path. Response body: $responseBody"
    }
}

internal fun parseCloudErrorPayload(responseBody: String): ParsedCloudErrorPayload? {
    if (responseBody.isBlank()) {
        return null
    }

    return try {
        val payload = JSONObject(responseBody)
        val nestedErrorValue = payload.opt("error")
        val nestedErrorObject = nestedErrorValue as? JSONObject
        val topLevelMessage = (nestedErrorValue as? String)
            ?: payload.optCloudStringOrNull("message", "error.message")
        val topLevelCode = payload.optCloudStringOrNull("code", "error.code")
        val nestedMessage = nestedErrorObject?.optCloudStringOrNull("message", "error.error.message")
        val nestedCode = nestedErrorObject?.optCloudStringOrNull("code", "error.error.code")
        val requestId = payload.optCloudStringOrNull("requestId", "error.requestId")
        val topLevelDetails = payload.optCloudObjectOrNull("details", "error.details")
        val nestedDetails = nestedErrorObject?.optCloudObjectOrNull("details", "error.error.details")
        ParsedCloudErrorPayload(
            message = topLevelMessage ?: nestedMessage,
            code = topLevelCode ?: nestedCode,
            requestId = requestId,
            syncConflict = parseSyncConflictDetails(
                details = topLevelDetails ?: nestedDetails
            )
        )
    } catch (_: JSONException) {
        null
    } catch (_: CloudContractMismatchException) {
        null
    }
}

private fun parseSyncConflictDetails(details: JSONObject?): CloudSyncConflictDetails? {
    if (details == null) {
        return null
    }

    return try {
        val syncConflict = details.optCloudObjectOrNull("syncConflict", "error.details.syncConflict") ?: return null
        CloudSyncConflictDetails(
            conflictingWorkspaceId = syncConflict.optCloudStringOrNull(
                key = "conflictingWorkspaceId",
                fieldPath = "error.details.syncConflict.conflictingWorkspaceId"
            ),
            remoteIsEmpty = syncConflict.optCloudBooleanOrNull(
                key = "remoteIsEmpty",
                fieldPath = "error.details.syncConflict.remoteIsEmpty"
            )
        )
    } catch (_: CloudContractMismatchException) {
        null
    }
}
