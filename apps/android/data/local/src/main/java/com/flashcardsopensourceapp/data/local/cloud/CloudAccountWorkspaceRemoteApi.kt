package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import org.json.JSONObject

internal class CloudAccountWorkspaceRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun fetchCloudAccount(apiBaseUrl: String, bearerToken: String): CloudAccountSnapshot {
        val meResponse = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = "/me",
            authorizationHeader = "Bearer $bearerToken"
        )
        val selectedWorkspaceId = meResponse.requireCloudNullableString("selectedWorkspaceId", "me.selectedWorkspaceId")
        val profile = meResponse.requireCloudObject("profile", "me.profile")
        val firstWorkspacePageResponse = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildPaginatedCloudPath(basePath = "/workspaces", cursor = null),
            authorizationHeader = "Bearer $bearerToken"
        )
        val firstWorkspacePage = parseCloudWorkspacePage(
            response = firstWorkspacePageResponse,
            selectedWorkspaceId = selectedWorkspaceId
        )
        var workspaces = firstWorkspacePage.workspaces
        var nextCursor = firstWorkspacePage.nextCursor
        while (nextCursor != null) {
            val nextPage = parseCloudWorkspacePage(
                response = httpClient.getJson(
                    baseUrl = apiBaseUrl,
                    path = buildPaginatedCloudPath(basePath = "/workspaces", cursor = nextCursor),
                    authorizationHeader = "Bearer $bearerToken"
                ),
                selectedWorkspaceId = selectedWorkspaceId
            )
            workspaces = workspaces + nextPage.workspaces
            nextCursor = nextPage.nextCursor
        }

        return CloudAccountSnapshot(
            userId = meResponse.requireCloudString("userId", "me.userId"),
            email = profile.requireCloudNullableString("email", "me.profile.email"),
            workspaces = workspaces
        )
    }

    suspend fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary> {
        return fetchCloudAccount(apiBaseUrl = apiBaseUrl, bearerToken = bearerToken).workspaces
    }

    suspend fun createWorkspace(apiBaseUrl: String, bearerToken: String, name: String): CloudWorkspaceSummary {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("name", name)
        )
        return parseCloudWorkspace(
            workspace = response.requireCloudObject("workspace", "createWorkspace.workspace"),
            isSelected = true,
            fieldPath = "createWorkspace.workspace"
        )
    }

    suspend fun selectWorkspace(apiBaseUrl: String, bearerToken: String, workspaceId: String): CloudWorkspaceSummary {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/select",
            authorizationHeader = "Bearer $bearerToken",
            body = null
        )
        return parseCloudWorkspace(
            workspace = response.requireCloudObject("workspace", "selectWorkspace.workspace"),
            isSelected = true,
            fieldPath = "selectWorkspace.workspace"
        )
    }

    suspend fun renameWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        name: String
    ): CloudWorkspaceSummary {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/rename",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("name", name)
        )
        return parseCloudWorkspace(
            workspace = response.requireCloudObject("workspace", "renameWorkspace.workspace"),
            isSelected = true,
            fieldPath = "renameWorkspace.workspace"
        )
    }

    suspend fun loadWorkspaceDeletePreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceDeletePreview {
        val response = httpClient.getJson(
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

    suspend fun deleteWorkspace(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceDeleteResult {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/delete",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("confirmationText", confirmationText)
        )
        return CloudWorkspaceDeleteResult(
            ok = response.requireCloudBoolean("ok", "deleteWorkspace.ok"),
            deletedWorkspaceId = response.requireCloudString("deletedWorkspaceId", "deleteWorkspace.deletedWorkspaceId"),
            deletedCardsCount = response.requireCloudInt("deletedCardsCount", "deleteWorkspace.deletedCardsCount"),
            workspace = parseCloudWorkspace(
                workspace = response.requireCloudObject("workspace", "deleteWorkspace.workspace"),
                isSelected = true,
                fieldPath = "deleteWorkspace.workspace"
            )
        )
    }

    suspend fun loadWorkspaceResetProgressPreview(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String
    ): CloudWorkspaceResetProgressPreview {
        val response = httpClient.getJson(
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

    suspend fun resetWorkspaceProgress(
        apiBaseUrl: String,
        bearerToken: String,
        workspaceId: String,
        confirmationText: String
    ): CloudWorkspaceResetProgressResult {
        val response = httpClient.postJson(
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

    suspend fun deleteAccount(
        apiBaseUrl: String,
        bearerToken: String,
        confirmationText: String
    ) {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/me/delete",
            authorizationHeader = "Bearer $bearerToken",
            body = JSONObject().put("confirmationText", confirmationText)
        )
        require(response.requireCloudBoolean("ok", "deleteAccount.ok")) {
            "Cloud delete-account did not return ok=true."
        }
    }
}

private data class CloudWorkspacePage(
    val workspaces: List<CloudWorkspaceSummary>,
    val nextCursor: String?
)

internal fun parseCloudWorkspace(
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

private fun parseCloudWorkspacePage(
    response: JSONObject,
    selectedWorkspaceId: String?
): CloudWorkspacePage {
    val items = response.requireCloudArray("workspaces", "workspaces.workspaces")
    return CloudWorkspacePage(
        workspaces = buildList {
            for (index in 0 until items.length()) {
                val workspace = items.requireCloudObject(index, "workspaces.workspaces[$index]")
                add(
                    parseCloudWorkspace(
                        workspace = workspace,
                        isSelected = workspace.requireCloudString(
                            "workspaceId",
                            "workspaces.workspaces[$index].workspaceId"
                        ) == selectedWorkspaceId,
                        fieldPath = "workspaces.workspaces[$index]"
                    )
                )
            }
        },
        nextCursor = response.requireCloudNullableString("nextCursor", "workspaces.nextCursor")
    )
}
