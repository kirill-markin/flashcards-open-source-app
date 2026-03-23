package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.makeIdTokenExpiryTimestampMillis
import com.flashcardsopensourceapp.data.local.model.parseIsoTimestamp
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

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
    val deviceId: String,
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

class CloudRemoteException(
    message: String,
    val statusCode: Int?,
    val responseBody: String?
) : Exception(message)

class CloudRemoteService {
    fun validateConfiguration(configuration: CloudServiceConfiguration) {
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

    fun sendCode(email: String, authBaseUrl: String): CloudSendCodeResult {
        val response = postJson(
            baseUrl = authBaseUrl,
            path = "/api/send-code",
            body = JSONObject().put("email", email.trim().lowercase())
        )
        require(response.optBoolean("ok")) {
            "Cloud send-code did not return ok=true."
        }

        val idToken = response.optString("idToken")
        val refreshToken = response.optString("refreshToken")
        val expiresIn = response.optInt("expiresIn", 0)
        if (idToken.isNotBlank() && refreshToken.isNotBlank() && expiresIn > 0) {
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

        val csrfToken = response.optString("csrfToken")
        val otpSessionToken = response.optString("otpSessionToken")
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

    fun verifyCode(challenge: CloudOtpChallenge, code: String, authBaseUrl: String): StoredCloudCredentials {
        val response = postJson(
            baseUrl = authBaseUrl,
            path = "/api/verify-code",
            body = JSONObject()
                .put("code", code.trim())
                .put("csrfToken", challenge.csrfToken)
                .put("otpSessionToken", challenge.otpSessionToken)
        )
        require(response.optBoolean("ok")) {
            "Cloud verify-code did not return ok=true."
        }

        val refreshToken = response.optString("refreshToken")
        val idToken = response.optString("idToken")
        val expiresIn = response.optInt("expiresIn", 0)
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

    fun refreshIdToken(refreshToken: String, authBaseUrl: String): StoredCloudCredentials {
        val response = postJson(
            baseUrl = authBaseUrl,
            path = "/api/refresh-token",
            body = JSONObject().put("refreshToken", refreshToken)
        )
        require(response.optBoolean("ok")) {
            "Cloud refresh-token did not return ok=true."
        }

        val idToken = response.optString("idToken")
        val expiresIn = response.optInt("expiresIn", 0)
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

    fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot {
        val meResponse = getJson(apiBaseUrl, "/me", authorizationHeader = "Bearer $bearerToken")
        val selectedWorkspaceId = meResponse.optString("selectedWorkspaceId").ifBlank { null }
        val profile = meResponse.optJSONObject("profile")
        val workspacesResponse = getJson(apiBaseUrl, buildPaginatedPath("/workspaces", null), "Bearer $bearerToken")
        val workspaces = mutableListOf<CloudWorkspaceSummary>()
        appendWorkspacePage(workspaces, workspacesResponse, selectedWorkspaceId)

        var nextCursor = workspacesResponse.optString("nextCursor").ifBlank { null }
        while (nextCursor != null) {
            val nextPage = getJson(
                apiBaseUrl,
                buildPaginatedPath("/workspaces", nextCursor),
                "Bearer $bearerToken"
            )
            appendWorkspacePage(workspaces, nextPage, selectedWorkspaceId)
            nextCursor = nextPage.optString("nextCursor").ifBlank { null }
        }

        return CloudAccountSnapshot(
            userId = meResponse.getString("userId"),
            email = profile?.optString("email")?.ifBlank { null },
            workspaces = workspaces
        )
    }

    fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary> {
        return fetchCloudAccount(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken).workspaces
    }

    fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("name", name)
        )
        return parseWorkspace(response.getJSONObject("workspace"), isSelected = true)
    }

    fun selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceSummary {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/select",
            authorizationHeader = "Bearer $bearerToken",
            body = null
        )
        return parseWorkspace(response.getJSONObject("workspace"), isSelected = true)
    }

    fun renameWorkspace(
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
        return parseWorkspace(response.getJSONObject("workspace"), isSelected = true)
    }

    fun loadWorkspaceDeletePreview(
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
            workspaceId = response.getString("workspaceId"),
            workspaceName = response.getString("workspaceName"),
            activeCardCount = response.getInt("activeCardCount"),
            confirmationText = response.getString("confirmationText"),
            isLastAccessibleWorkspace = response.getBoolean("isLastAccessibleWorkspace")
        )
    }

    fun deleteWorkspace(
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
            ok = response.getBoolean("ok"),
            deletedWorkspaceId = response.getString("deletedWorkspaceId"),
            deletedCardsCount = response.getInt("deletedCardsCount"),
            workspace = parseWorkspace(response.getJSONObject("workspace"), isSelected = true)
        )
    }

    fun deleteAccount(
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
        require(response.optBoolean("ok")) {
            "Cloud delete-account did not return ok=true."
        }
    }

    fun listAgentConnections(apiBaseUrl: String, bearerToken: String): AgentApiKeyConnectionsResult {
        val connections = mutableListOf<AgentApiKeyConnection>()
        var nextCursor: String? = null
        var instructions: String = ""

        do {
            val response = getJson(
                baseUrl = apiBaseUrl,
                path = buildPaginatedPath(basePath = "/agent-api-keys", cursor = nextCursor),
                authorizationHeader = "Bearer $bearerToken"
            )
            instructions = response.optString("instructions")
            val items = response.getJSONArray("connections")
            for (index in 0 until items.length()) {
                connections.add(parseAgentApiKeyConnection(items.getJSONObject(index)))
            }
            nextCursor = response.optString("nextCursor").ifBlank { null }
        } while (nextCursor != null)

        return AgentApiKeyConnectionsResult(
            connections = connections,
            instructions = instructions
        )
    }

    fun revokeAgentConnection(
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
            connections = listOf(parseAgentApiKeyConnection(response.getJSONObject("connection"))),
            instructions = response.optString("instructions")
        )
    }

    fun push(apiBaseUrl: String, bearerToken: String, workspaceId: String, body: JSONObject): RemotePushResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/push",
            authorizationHeader = "Bearer $bearerToken",
            body = body
        )
        val operations = response.getJSONArray("operations")
        return RemotePushResponse(
            operations = buildList {
                for (index in 0 until operations.length()) {
                    val entry = operations.getJSONObject(index)
                    val status = entry.getString("status")
                    if (status != "applied" && status != "duplicate") {
                        throw CloudRemoteException(
                            message = "Cloud push failed for operation ${entry.getString("operationId")}: ${entry.optString("error")}",
                            statusCode = 200,
                            responseBody = response.toString()
                        )
                    }
                    add(
                        RemotePushOperationResult(
                            operationId = entry.getString("operationId"),
                            resultingHotChangeId = entry.optLongOrNull("resultingHotChangeId")
                        )
                    )
                }
            }
        )
    }

    fun pull(apiBaseUrl: String, bearerToken: String, workspaceId: String, body: JSONObject): RemotePullResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/pull",
            authorizationHeader = "Bearer $bearerToken",
            body = body
        )

        return RemotePullResponse(
            changes = parseHotChanges(response.getJSONArray("changes")),
            nextHotChangeId = response.getLong("nextHotChangeId"),
            hasMore = response.getBoolean("hasMore")
        )
    }

    fun bootstrapPull(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPullResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/bootstrap",
            authorizationHeader = "Bearer $bearerToken",
            body = body
        )

        return RemoteBootstrapPullResponse(
            entries = parseBootstrapEntries(response.getJSONArray("entries")),
            nextCursor = response.optString("nextCursor").ifBlank { null },
            hasMore = response.getBoolean("hasMore"),
            bootstrapHotChangeId = response.getLong("bootstrapHotChangeId"),
            remoteIsEmpty = response.getBoolean("remoteIsEmpty")
        )
    }

    fun bootstrapPush(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteBootstrapPushResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/bootstrap",
            authorizationHeader = "Bearer $bearerToken",
            body = body
        )

        return RemoteBootstrapPushResponse(
            appliedEntriesCount = response.getInt("appliedEntriesCount"),
            bootstrapHotChangeId = response.optLongOrNull("bootstrapHotChangeId")
        )
    }

    fun pullReviewHistory(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryPullResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/review-history/pull",
            authorizationHeader = "Bearer $bearerToken",
            body = body
        )

        return RemoteReviewHistoryPullResponse(
            reviewEvents = parseReviewHistoryEvents(response.getJSONArray("reviewEvents")),
            nextReviewSequenceId = response.getLong("nextReviewSequenceId"),
            hasMore = response.getBoolean("hasMore")
        )
    }

    fun importReviewHistory(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        body: JSONObject
    ): RemoteReviewHistoryImportResponse {
        val response = postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/sync/review-history/import",
            authorizationHeader = "Bearer $bearerToken",
            body = body
        )

        return RemoteReviewHistoryImportResponse(
            importedCount = response.getInt("importedCount"),
            duplicateCount = response.getInt("duplicateCount"),
            nextReviewSequenceId = response.optLongOrNull("nextReviewSequenceId")
        )
    }

    private fun appendWorkspacePage(
        workspaces: MutableList<CloudWorkspaceSummary>,
        response: JSONObject,
        selectedWorkspaceId: String?
    ) {
        val items = response.getJSONArray("workspaces")
        for (index in 0 until items.length()) {
            val workspace = items.getJSONObject(index)
            workspaces.add(
                parseWorkspace(
                    workspace = workspace,
                    isSelected = workspace.getString("workspaceId") == selectedWorkspaceId
                )
            )
        }
    }

    private fun parseWorkspace(workspace: JSONObject, isSelected: Boolean): CloudWorkspaceSummary {
        return CloudWorkspaceSummary(
            workspaceId = workspace.getString("workspaceId"),
            name = workspace.getString("name"),
            createdAtMillis = parseIsoTimestamp(workspace.getString("createdAt")),
            isSelected = isSelected
        )
    }

    private fun parseAgentApiKeyConnection(connection: JSONObject): AgentApiKeyConnection {
        return AgentApiKeyConnection(
            connectionId = connection.getString("connectionId"),
            label = connection.getString("label"),
            createdAtMillis = parseIsoTimestamp(connection.getString("createdAt")),
            lastUsedAtMillis = connection.optString("lastUsedAt").ifBlank { null }?.let(::parseIsoTimestamp),
            revokedAtMillis = connection.optString("revokedAt").ifBlank { null }?.let(::parseIsoTimestamp)
        )
    }

    private fun parseHotChanges(changes: JSONArray): List<RemoteSyncChange> {
        return buildList {
            for (index in 0 until changes.length()) {
                val change = changes.getJSONObject(index)
                add(
                    RemoteSyncChange(
                        changeId = change.getLong("changeId"),
                        entityType = parseSyncEntityType(change.getString("entityType")),
                        entityId = change.getString("entityId"),
                        action = change.getString("action"),
                        payload = change.getJSONObject("payload")
                    )
                )
            }
        }
    }

    private fun parseBootstrapEntries(entries: JSONArray): List<RemoteBootstrapEntry> {
        return buildList {
            for (index in 0 until entries.length()) {
                val entry = entries.getJSONObject(index)
                add(
                    RemoteBootstrapEntry(
                        entityType = parseSyncEntityType(entry.getString("entityType")),
                        entityId = entry.getString("entityId"),
                        action = entry.getString("action"),
                        payload = entry.getJSONObject("payload")
                    )
                )
            }
        }
    }

    private fun parseReviewHistoryEvents(events: JSONArray): List<RemoteReviewHistoryEvent> {
        return buildList {
            for (index in 0 until events.length()) {
                val event = events.getJSONObject(index)
                add(
                    RemoteReviewHistoryEvent(
                        reviewEventId = event.getString("reviewEventId"),
                        workspaceId = event.getString("workspaceId"),
                        cardId = event.getString("cardId"),
                        deviceId = event.getString("deviceId"),
                        clientEventId = event.getString("clientEventId"),
                        rating = event.getInt("rating"),
                        reviewedAtClient = event.getString("reviewedAtClient"),
                        reviewedAtServer = event.getString("reviewedAtServer")
                    )
                )
            }
        }
    }

    private fun parseSyncEntityType(rawValue: String): SyncEntityType {
        return when (rawValue) {
            "card" -> SyncEntityType.CARD
            "deck" -> SyncEntityType.DECK
            "workspace_scheduler_settings" -> SyncEntityType.WORKSPACE_SCHEDULER_SETTINGS
            "review_event" -> SyncEntityType.REVIEW_EVENT
            else -> throw IllegalArgumentException("Unsupported remote sync entity type: $rawValue")
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

    private fun getJson(
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

    private fun postJson(
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

    private fun executeJsonRequest(
        baseUrl: String,
        path: String,
        method: String,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject {
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

        return try {
            val statusCode = connection.responseCode
            val responseBody = readConnectionBody(connection = connection, useErrorStream = statusCode >= 400)
            if (statusCode < 200 || statusCode >= 300) {
                throw CloudRemoteException(
                    message = "Cloud request failed with status $statusCode for $path: $responseBody",
                    statusCode = statusCode,
                    responseBody = responseBody
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

private fun JSONObject.optLongOrNull(key: String): Long? {
    return if (has(key) && isNull(key).not()) {
        getLong(key)
    } else {
        null
    }
}
