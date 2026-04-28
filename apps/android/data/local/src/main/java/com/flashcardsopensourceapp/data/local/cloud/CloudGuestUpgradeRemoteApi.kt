package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeDroppedEntity
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeDroppedEntityType
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeReconciliation
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import org.json.JSONArray
import org.json.JSONObject

internal class CloudGuestUpgradeRemoteApi(
    private val httpClient: CloudJsonHttpClient
) {
    suspend fun deleteGuestSession(apiBaseUrl: String, guestToken: String) {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/guest-auth/session/delete",
            authorizationHeader = "Guest $guestToken",
            body = null
        )
        require(response.requireCloudBoolean("ok", "deleteGuestSession.ok")) {
            "Cloud delete-guest-session did not return ok=true."
        }
    }

    suspend fun prepareGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String
    ): CloudGuestUpgradeMode {
        val response = httpClient.postJson(
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

    suspend fun completeGuestUpgrade(
        apiBaseUrl: String,
        bearerToken: String,
        guestToken: String,
        selection: CloudGuestUpgradeSelection,
        guestWorkspaceSyncedAndOutboxDrained: Boolean,
        supportsDroppedEntities: Boolean
    ): CloudGuestUpgradeCompletion {
        val response = httpClient.postJson(
            baseUrl = apiBaseUrl,
            path = "/guest-auth/upgrade/complete",
            authorizationHeader = "Bearer $bearerToken",
            body = buildGuestUpgradeCompleteRequest(
                guestToken = guestToken,
                selection = selection,
                guestWorkspaceSyncedAndOutboxDrained = guestWorkspaceSyncedAndOutboxDrained,
                supportsDroppedEntities = supportsDroppedEntities
            )
        )
        return CloudGuestUpgradeCompletion(
            workspace = parseCloudWorkspace(
                workspace = response.requireCloudObject("workspace", "guestUpgradeComplete.workspace"),
                isSelected = true,
                fieldPath = "guestUpgradeComplete.workspace"
            ),
            reconciliation = parseGuestUpgradeReconciliation(
                response = response
            )
        )
    }
}

internal fun buildGuestUpgradeCompleteRequest(
    guestToken: String,
    selection: CloudGuestUpgradeSelection,
    guestWorkspaceSyncedAndOutboxDrained: Boolean,
    supportsDroppedEntities: Boolean
): JSONObject {
    return JSONObject()
        .put("guestToken", guestToken)
        .put("selection", encodeGuestUpgradeSelection(selection = selection))
        .put("guestWorkspaceSyncedAndOutboxDrained", guestWorkspaceSyncedAndOutboxDrained)
        .put("supportsDroppedEntities", supportsDroppedEntities)
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

private fun parseGuestUpgradeReconciliation(response: JSONObject): CloudGuestUpgradeReconciliation? {
    val droppedEntities = response.optCloudObjectOrNull(
        key = "droppedEntities",
        fieldPath = "guestUpgradeComplete.droppedEntities"
    ) ?: return null
    val droppedCardIds = droppedEntities.optCloudArrayOrNull(
        key = "cardIds",
        fieldPath = "guestUpgradeComplete.droppedEntities.cardIds"
    ) ?: JSONArray()
    val droppedDeckIds = droppedEntities.optCloudArrayOrNull(
        key = "deckIds",
        fieldPath = "guestUpgradeComplete.droppedEntities.deckIds"
    ) ?: JSONArray()
    val droppedReviewEventIds = droppedEntities.optCloudArrayOrNull(
        key = "reviewEventIds",
        fieldPath = "guestUpgradeComplete.droppedEntities.reviewEventIds"
    ) ?: JSONArray()
    return CloudGuestUpgradeReconciliation(
        droppedEntities = buildList {
            for (index in 0 until droppedCardIds.length()) {
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.CARD,
                        entityId = droppedCardIds.requireCloudString(
                            index = index,
                            fieldPath = "guestUpgradeComplete.droppedEntities.cardIds[$index]"
                        )
                    )
                )
            }
            for (index in 0 until droppedDeckIds.length()) {
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.DECK,
                        entityId = droppedDeckIds.requireCloudString(
                            index = index,
                            fieldPath = "guestUpgradeComplete.droppedEntities.deckIds[$index]"
                        )
                    )
                )
            }
            for (index in 0 until droppedReviewEventIds.length()) {
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.REVIEW_EVENT,
                        entityId = droppedReviewEventIds.requireCloudString(
                            index = index,
                            fieldPath = "guestUpgradeComplete.droppedEntities.reviewEventIds[$index]"
                        )
                    )
                )
            }
        }
    )
}
