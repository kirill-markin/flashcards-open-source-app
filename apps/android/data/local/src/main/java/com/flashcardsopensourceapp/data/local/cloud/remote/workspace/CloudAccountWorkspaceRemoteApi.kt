package com.flashcardsopensourceapp.data.local.cloud.remote.workspace

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudJsonHttpClient
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.buildPaginatedCloudPath
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudBooleanOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.parseReviewPromptConfig
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudIsoTimestampMillis
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.cloud.wire.toCloudStringList
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferencesUpdate
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.sync.CloudAuthenticatedAccountIdentity
import com.flashcardsopensourceapp.data.local.model.sync.parseAccountTheme
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceConfirmation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenancePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeletePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceDeleteResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceResetProgressResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.review.prompts.RemoteReviewPromptConfig
import org.json.JSONObject

internal class CloudAccountWorkspaceRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun fetchCloudAccount(apiBaseUrl: String, authorizationHeader: String): CloudAccountSnapshot {
        val meResponse = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = "/me",
            authorizationHeader = authorizationHeader
        )
        val selectedWorkspaceId = meResponse.requireCloudNullableString("selectedWorkspaceId", "me.selectedWorkspaceId")
        val profile = meResponse.requireCloudObject("profile", "me.profile")
        val preferences = parseAccountPreferences(
            preferences = meResponse.requireCloudObject("preferences", "me.preferences"),
            fieldPath = "me.preferences"
        )
        val firstWorkspacePageResponse = httpClient.getJson(
            baseUrl = apiBaseUrl,
            path = buildPaginatedCloudPath(basePath = "/workspaces", cursor = null),
            authorizationHeader = authorizationHeader
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
                    authorizationHeader = authorizationHeader
                ),
                selectedWorkspaceId = selectedWorkspaceId
            )
            workspaces = workspaces + nextPage.workspaces
            nextCursor = nextPage.nextCursor
        }

        val userId: String = meResponse.requireCloudString("userId", "me.userId")
        return CloudAccountSnapshot(
            userId = userId,
            email = profile.requireCloudNullableString("email", "me.profile.email"),
            preferences = preferences,
            workspaces = workspaces,
            authenticatedIdentity = parseAuthenticatedAccountIdentity(response = meResponse, userId = userId),
            reviewPromptConfig = parseRemoteReviewPromptConfig(response = meResponse)
        )
    }

    suspend fun listLinkedWorkspaces(apiBaseUrl: String, bearerToken: String): List<CloudWorkspaceSummary> {
        return fetchCloudAccount(apiBaseUrl = apiBaseUrl, authorizationHeader = "Bearer $bearerToken").workspaces
    }

    suspend fun updateAccountPreferences(
        apiBaseUrl: String,
        authorizationHeader: String,
        update: AccountPreferencesUpdate
    ): AccountPreferences {
        val body = JSONObject()
        update.accentColor?.let { color ->
            body.put("accentColor", color)
        }
        update.theme?.let { theme ->
            body.put("theme", theme.wireValue)
        }
        update.reviewReactionAnimationsEnabled?.let { enabled ->
            body.put("reviewReactionAnimationsEnabled", enabled)
        }
        update.productAnalyticsEnabled?.let { enabled ->
            body.put("productAnalyticsEnabled", enabled)
        }
        update.productAnalyticsEnabledOrigin?.let { origin ->
            body.put("productAnalyticsEnabledOrigin", origin.wireValue)
        }
        update.firstReviewOnboardingCompleted?.let { completed ->
            body.put("firstReviewOnboardingCompleted", completed)
        }
        update.locale?.let { locale ->
            body.put("locale", locale)
        }
        val response = httpClient.patchJson(
            baseUrl = apiBaseUrl,
            path = "/me/preferences",
            authorizationHeader = authorizationHeader,
            body = body
        )
        return parseAccountPreferences(
            preferences = response.requireCloudObject("preferences", "accountPreferences.preferences"),
            fieldPath = "accountPreferences.preferences"
        )
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

    suspend fun previewCardMaintenance(
        apiBaseUrl: String,
        bearerToken: String,
        target: CloudCardMaintenanceTarget
    ): CloudCardMaintenancePreview {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/${target.workspaceId}/card-maintenance/preview",
            authorizationHeader = "Bearer $bearerToken",
            body = cardMaintenanceTargetBody(target = target)
        )
        return CloudCardMaintenancePreview(
            targetName = response.requireCloudString("targetName", "cardMaintenancePreview.targetName"),
            affectedCardsCount = response.requireCloudInt("affectedCardsCount", "cardMaintenancePreview.affectedCardsCount"),
            confirmationText = response.requireCloudString("confirmationText", "cardMaintenancePreview.confirmationText"),
            previewFingerprint = response.requireCloudString("previewFingerprint", "cardMaintenancePreview.previewFingerprint"),
            includesAllCards = response.requireCloudBoolean("includesAllCards", "cardMaintenancePreview.includesAllCards"),
            affectedDecksCount = response.requireCloudInt("affectedDecksCount", "cardMaintenancePreview.affectedDecksCount")
        )
    }

    suspend fun executeCardMaintenance(
        apiBaseUrl: String,
        bearerToken: String,
        confirmation: CloudCardMaintenanceConfirmation
    ): Int {
        val response = httpClient.postJsonOnce(
            baseUrl = apiBaseUrl,
            path = "/workspaces/${confirmation.target.workspaceId}/card-maintenance/execute",
            authorizationHeader = "Bearer $bearerToken",
            body = cardMaintenanceTargetBody(target = confirmation.target)
                .put("confirmationText", confirmation.confirmationText)
                .put("previewFingerprint", confirmation.previewFingerprint)
        )
        return response.requireCloudInt("affectedCardsCount", "cardMaintenanceResult.affectedCardsCount")
    }

    suspend fun reconcileCardMaintenance(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        previewFingerprint: String
    ): Boolean {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/workspaces/$workspaceId/card-maintenance/reconcile",
            authorizationHeader = authorizationHeader,
            body = JSONObject().put("previewFingerprint", previewFingerprint)
        )
        return response.requireCloudBoolean("isSettled", "cardMaintenanceReconciliation.isSettled")
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

private fun parseAuthenticatedAccountIdentity(response: JSONObject, userId: String): CloudAuthenticatedAccountIdentity? {
    if (!response.has("canonicalAccountId") && !response.has("linkedAccountIds")) {
        return null
    }
    val canonicalAccountId: String = response.requireCloudString("canonicalAccountId", "me.canonicalAccountId")
    val linkedAccountIds: List<String> = response.requireCloudArray("linkedAccountIds", "me.linkedAccountIds")
        .toCloudStringList(fieldPath = "me.linkedAccountIds")
    if (canonicalAccountId.isBlank() || linkedAccountIds.any(String::isBlank) ||
        canonicalAccountId !in linkedAccountIds || userId !in linkedAccountIds
    ) {
        throw CloudContractMismatchException("Cloud account identity must include the credential and canonical account IDs.")
    }
    return CloudAuthenticatedAccountIdentity(userId, canonicalAccountId, linkedAccountIds)
}

/** A malformed value is returned as rejected, never thrown: it must not fail the account fetch. */
private fun parseRemoteReviewPromptConfig(response: JSONObject): RemoteReviewPromptConfig? {
    if (response.has("reviewPrompts").not()) {
        return null
    }
    return try {
        RemoteReviewPromptConfig.Valid(
            config = parseReviewPromptConfig(
                json = response.requireCloudObject("reviewPrompts", "me.reviewPrompts"),
                fieldPath = "me.reviewPrompts"
            )
        )
    } catch (error: CloudContractMismatchException) {
        RemoteReviewPromptConfig.Rejected(error = error)
    }
}

internal fun parseCloudWorkspace(
    workspace: JSONObject,
    isSelected: Boolean,
    fieldPath: String
): CloudWorkspaceSummary {
    return CloudWorkspaceSummary(
        workspaceId = workspace.requireCloudString("workspaceId", "$fieldPath.workspaceId"),
        name = workspace.requireCloudString("name", "$fieldPath.name"),
        createdAtMillis = workspace.requireCloudIsoTimestampMillis("createdAt", "$fieldPath.createdAt"),
        isSelected = isSelected,
        isVisible = if (workspace.has("isVisible")) {
            workspace.requireCloudBoolean("isVisible", "$fieldPath.isVisible")
        } else {
            true
        }
    )
}

internal fun parseAccountPreferences(
    preferences: JSONObject,
    fieldPath: String
): AccountPreferences {
    return AccountPreferences(
        accentColor = preferences.requireCloudString("accentColor", "$fieldPath.accentColor"),
        theme = parseAccountTheme(wireValue = preferences.requireCloudString("theme", "$fieldPath.theme")),
        reviewReactionAnimationsEnabled = preferences.requireCloudBoolean(
            "reviewReactionAnimationsEnabled",
            "$fieldPath.reviewReactionAnimationsEnabled"
        ),
        // Absent as well as null means nobody answered, which reads as on.
        productAnalyticsEnabled = preferences.optCloudBooleanOrNull(
            "productAnalyticsEnabled",
            "$fieldPath.productAnalyticsEnabled"
        ),
        firstReviewOnboardingCompleted = preferences.requireCloudBoolean(
            "firstReviewOnboardingCompleted", "$fieldPath.firstReviewOnboardingCompleted"
        )
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

private fun cardMaintenanceTargetBody(target: CloudCardMaintenanceTarget): JSONObject {
    return JSONObject().put("kind", target.kind.wireValue).put("target", target.target)
}
