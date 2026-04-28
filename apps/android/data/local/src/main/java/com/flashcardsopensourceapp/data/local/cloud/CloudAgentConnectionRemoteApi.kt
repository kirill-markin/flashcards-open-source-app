package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnectionsResult
import org.json.JSONObject

internal class CloudAgentConnectionRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun listAgentConnections(apiBaseUrl: String, bearerToken: String): AgentApiKeyConnectionsResult {
        var connections: List<AgentApiKeyConnection> = emptyList()
        var nextCursor: String? = null
        var instructions = ""

        do {
            val page = parseAgentConnectionPage(
                response = httpClient.getJson(
                    baseUrl = apiBaseUrl,
                    path = buildPaginatedCloudPath(basePath = "/agent-api-keys", cursor = nextCursor),
                    authorizationHeader = "Bearer $bearerToken"
                )
            )
            instructions = page.instructions
            connections = connections + page.connections
            nextCursor = page.nextCursor
        } while (nextCursor != null)

        return AgentApiKeyConnectionsResult(
            connections = connections,
            instructions = instructions
        )
    }

    suspend fun revokeAgentConnection(
        apiBaseUrl: String,
        bearerToken: String,
        connectionId: String
    ): AgentApiKeyConnectionsResult {
        val response = httpClient.postJson(
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

    private fun parseAgentConnectionPage(response: JSONObject): AgentConnectionPage {
        val items = response.requireCloudArray("connections", "agentApiKeys.connections")
        return AgentConnectionPage(
            connections = buildList {
                for (index in 0 until items.length()) {
                    add(
                        parseAgentApiKeyConnection(
                            connection = items.requireCloudObject(index, "agentApiKeys.connections[$index]"),
                            fieldPath = "agentApiKeys.connections[$index]"
                        )
                    )
                }
            },
            instructions = response.requireCloudString("instructions", "agentApiKeys.instructions"),
            nextCursor = response.requireCloudNullableString("nextCursor", "agentApiKeys.nextCursor")
        )
    }
}

private data class AgentConnectionPage(
    val connections: List<AgentApiKeyConnection>,
    val instructions: String,
    val nextCursor: String?
)
