package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.cloud.wire.putNullableString
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDroppedEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeDroppedEntityType
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeReconciliation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.cloud.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.AccountTheme
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccentColor
import com.flashcardsopensourceapp.data.local.model.sync.defaultAccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.parseAccountTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

internal class CloudPendingGuestUpgradeStore(
    private val credentialStore: CloudCredentialStore,
    private val socialAuthStore: CloudSocialAuthStore
) {
    private val isGuestUpgradePending = MutableStateFlow<Boolean?>(null)

    fun observePendingGuestUpgrade(): Flow<Boolean> {
        return isGuestUpgradePending.map { pending -> pending ?: hasPendingGuestUpgrade() }
    }

    fun loadPendingGuestUpgrade(): PendingGuestUpgradeState? {
        val rawValue = credentialStore.load().pendingGuestUpgrade ?: return null
        return try {
            decodePendingGuestUpgrade(rawValue = rawValue)
        } catch (error: JSONException) {
            throw pendingGuestUpgradeRecoveryStateCorruptError(cause = error)
        } catch (error: IllegalArgumentException) {
            throw pendingGuestUpgradeRecoveryStateCorruptError(cause = error)
        } catch (error: IllegalStateException) {
            throw pendingGuestUpgradeRecoveryStateCorruptError(cause = error)
        }
    }

    fun savePendingGuestUpgrade(pendingGuestUpgradeState: PendingGuestUpgradeState) {
        credentialStore.update { secrets ->
            secrets.copy(
                pendingGuestUpgrade = encodePendingGuestUpgrade(pendingGuestUpgradeState = pendingGuestUpgradeState).toString()
            )
        }
        isGuestUpgradePending.value = true
    }

    fun stagePendingGuestUpgrade(upgrade: PendingGuestUpgradeState, socialAttemptId: String?) {
        credentialStore.update { secrets ->
            secrets.copy(
                pendingGuestUpgrade = encodePendingGuestUpgrade(pendingGuestUpgradeState = upgrade).toString(),
                pendingSocialSignIn = socialAuthStore.stageGuestUpgradeSelection(secrets, socialAttemptId, upgrade.selection)
            )
        }
        isGuestUpgradePending.value = true
    }

    fun rejectGuestUpgradeDestination(upgrade: PendingGuestUpgradeState, workspaceId: String) {
        credentialStore.update { secrets ->
            secrets.copy(
                pendingGuestUpgrade = null,
                pendingSocialSignIn = socialAuthStore.rejectGuestUpgradeSelection(secrets, upgrade, workspaceId)
            )
        }
        isGuestUpgradePending.value = false
    }

    fun clearPendingGuestUpgrade() {
        credentialStore.update { secrets ->
            secrets.copy(pendingGuestUpgrade = null)
        }
        isGuestUpgradePending.value = false
    }

    suspend fun hasPendingGuestUpgrade(): Boolean {
        return withContext(Dispatchers.IO) {
            credentialStore.load().pendingGuestUpgrade != null
        }
    }

    fun onCredentialsCleared() {
        isGuestUpgradePending.value = false
    }
}

internal data class PendingGuestUpgradeState(
    val configuration: CloudServiceConfiguration,
    val credentials: StoredCloudCredentials,
    val accountSnapshot: CloudAccountSnapshot,
    val guestSession: StoredGuestAiSession,
    val guestUpgradeMode: CloudGuestUpgradeMode,
    val selection: CloudWorkspaceLinkSelection,
    val completion: CloudGuestUpgradeCompletion?
) {
    init {
        require(selection !is CloudWorkspaceLinkSelection.Existing || !selection.discardDemoOnly ||
            (guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED && selection.workspaceId.isNotBlank())) {
            "Pending demo-only disposal requires a merge-required upgrade with an existing destination."
        }
    }
}

private fun encodePendingGuestUpgrade(pendingGuestUpgradeState: PendingGuestUpgradeState): JSONObject {
    val jsonObject = JSONObject()
        .put("configuration", encodeConfiguration(configuration = pendingGuestUpgradeState.configuration))
        .put("credentials", encodeCredentials(credentials = pendingGuestUpgradeState.credentials))
        .put("accountSnapshot", encodeAccountSnapshot(accountSnapshot = pendingGuestUpgradeState.accountSnapshot))
        .put("guestSession", encodeGuestSession(session = pendingGuestUpgradeState.guestSession))
        .put("guestUpgradeMode", pendingGuestUpgradeState.guestUpgradeMode.name)
        .put("selection", encodeWorkspaceLinkSelection(selection = pendingGuestUpgradeState.selection))
    val completion: CloudGuestUpgradeCompletion? = pendingGuestUpgradeState.completion
    if (completion == null) {
        jsonObject.put("completion", JSONObject.NULL)
    } else {
        jsonObject.put(
            "completion",
            encodeGuestUpgradeCompletion(completion = completion)
        )
    }
    return jsonObject
}

private fun decodePendingGuestUpgrade(rawValue: String): PendingGuestUpgradeState {
    val jsonObject = JSONObject(rawValue)
    return PendingGuestUpgradeState(
        configuration = decodeConfiguration(jsonObject = jsonObject.getJSONObject("configuration")),
        credentials = decodeCredentials(jsonObject = jsonObject.getJSONObject("credentials")),
        accountSnapshot = decodeAccountSnapshot(jsonObject = jsonObject.getJSONObject("accountSnapshot")),
        guestSession = decodeGuestSession(jsonObject = jsonObject.getJSONObject("guestSession")),
        guestUpgradeMode = CloudGuestUpgradeMode.valueOf(jsonObject.getString("guestUpgradeMode")),
        selection = decodeWorkspaceLinkSelection(jsonObject = jsonObject.getJSONObject("selection")),
        completion = decodeNullableGuestUpgradeCompletion(jsonObject = jsonObject)
    )
}

private fun pendingGuestUpgradeRecoveryStateCorruptError(cause: Throwable): IllegalStateException {
    return IllegalStateException(
        "Pending guest upgrade recovery state is corrupt and cannot be resumed. " +
            "Sign out and sign in again to reset cloud identity recovery. Cause='${cause.message}'.",
        cause
    )
}

private fun encodeConfiguration(configuration: CloudServiceConfiguration): JSONObject {
    return JSONObject()
        .put("mode", configuration.mode.name)
        .putNullableString(key = "customOrigin", value = configuration.customOrigin)
        .put("apiBaseUrl", configuration.apiBaseUrl)
        .put("authBaseUrl", configuration.authBaseUrl)
}

private fun decodeConfiguration(jsonObject: JSONObject): CloudServiceConfiguration {
    return CloudServiceConfiguration(
        mode = CloudServiceConfigurationMode.valueOf(jsonObject.getString("mode")),
        customOrigin = jsonObject.getNullableString(key = "customOrigin"),
        apiBaseUrl = jsonObject.getString("apiBaseUrl"),
        authBaseUrl = jsonObject.getString("authBaseUrl")
    )
}

private fun encodeCredentials(credentials: StoredCloudCredentials): JSONObject {
    return JSONObject()
        .put("refreshToken", credentials.refreshToken)
        .put("idToken", credentials.idToken)
        .put("idTokenExpiresAtMillis", credentials.idTokenExpiresAtMillis)
}

private fun decodeCredentials(jsonObject: JSONObject): StoredCloudCredentials {
    return StoredCloudCredentials(
        refreshToken = jsonObject.getString("refreshToken"),
        idToken = jsonObject.getString("idToken"),
        idTokenExpiresAtMillis = jsonObject.getLong("idTokenExpiresAtMillis")
    )
}

private fun encodeAccountSnapshot(accountSnapshot: CloudAccountSnapshot): JSONObject {
    return JSONObject()
        .put("userId", accountSnapshot.userId)
        .putNullableString(key = "email", value = accountSnapshot.email)
        .put("preferences", encodeAccountPreferences(preferences = accountSnapshot.preferences))
        .put("workspaces", encodeWorkspaces(workspaces = accountSnapshot.workspaces))
}

private fun decodeAccountSnapshot(jsonObject: JSONObject): CloudAccountSnapshot {
    return CloudAccountSnapshot(
        userId = jsonObject.getString("userId"),
        email = jsonObject.getNullableString(key = "email"),
        preferences = decodeStoredAccountPreferences(jsonObject = jsonObject),
        workspaces = decodeWorkspaces(jsonArray = jsonObject.getJSONArray("workspaces"))
    )
}

private fun encodeAccountPreferences(preferences: AccountPreferences): JSONObject {
    return JSONObject()
        .put("accentColor", preferences.accentColor)
        .put("theme", preferences.theme.wireValue)
        .put("reviewReactionAnimationsEnabled", preferences.reviewReactionAnimationsEnabled)
        .put("firstReviewOnboardingCompleted", preferences.firstReviewOnboardingCompleted ?: JSONObject.NULL)
        .put("productAnalyticsEnabled", preferences.productAnalyticsEnabled ?: JSONObject.NULL)
}

private fun decodeAccountPreferences(jsonObject: JSONObject?): AccountPreferences {
    jsonObject ?: return defaultAccountPreferences().copy(firstReviewOnboardingCompleted = null)
    return AccountPreferences(
        accentColor = if (jsonObject.has("accentColor")) {
            jsonObject.getString("accentColor")
        } else {
            defaultAccentColor
        },
        theme = if (jsonObject.has("theme")) {
            parseAccountTheme(wireValue = jsonObject.getString("theme"))
        } else {
            AccountTheme.DARK
        },
        reviewReactionAnimationsEnabled = jsonObject.getBoolean("reviewReactionAnimationsEnabled"),
        firstReviewOnboardingCompleted = if (
            !jsonObject.has("firstReviewOnboardingCompleted") || jsonObject.isNull("firstReviewOnboardingCompleted")
        ) {
            null
        } else {
            jsonObject.getBoolean("firstReviewOnboardingCompleted")
        },
        productAnalyticsEnabled = if (jsonObject.isNull("productAnalyticsEnabled")) {
            null
        } else {
            jsonObject.getBoolean("productAnalyticsEnabled")
        }
    )
}

private fun decodeStoredAccountPreferences(jsonObject: JSONObject): AccountPreferences {
    return if (jsonObject.has("preferences").not() || jsonObject.isNull("preferences")) {
        defaultAccountPreferences().copy(firstReviewOnboardingCompleted = null)
    } else {
        decodeAccountPreferences(jsonObject = jsonObject.getJSONObject("preferences"))
    }
}

private fun encodeWorkspaces(workspaces: List<CloudWorkspaceSummary>): JSONArray {
    val jsonArray = JSONArray()
    workspaces.forEach { workspace ->
        jsonArray.put(encodeWorkspace(workspace = workspace))
    }
    return jsonArray
}

private fun decodeWorkspaces(jsonArray: JSONArray): List<CloudWorkspaceSummary> {
    return buildList {
        for (index in 0 until jsonArray.length()) {
            add(decodeWorkspace(jsonObject = jsonArray.getJSONObject(index)))
        }
    }
}

private fun encodeWorkspace(workspace: CloudWorkspaceSummary): JSONObject {
    return JSONObject()
        .put("workspaceId", workspace.workspaceId)
        .put("name", workspace.name)
        .put("createdAtMillis", workspace.createdAtMillis)
        .put("isSelected", workspace.isSelected)
        .put("isVisible", workspace.isVisible)
}

private fun decodeWorkspace(jsonObject: JSONObject): CloudWorkspaceSummary {
    return CloudWorkspaceSummary(
        workspaceId = jsonObject.getString("workspaceId"),
        name = jsonObject.getString("name"),
        createdAtMillis = jsonObject.getLong("createdAtMillis"),
        isSelected = jsonObject.getBoolean("isSelected"),
        isVisible = if (jsonObject.has("isVisible")) jsonObject.getBoolean("isVisible") else true
    )
}

private fun encodeGuestSession(session: StoredGuestAiSession): JSONObject {
    return JSONObject()
        .put("guestToken", session.guestToken)
        .put("userId", session.userId)
        .put("workspaceId", session.workspaceId)
        .put("configurationMode", session.configurationMode.name)
        .put("apiBaseUrl", session.apiBaseUrl)
}

private fun decodeGuestSession(jsonObject: JSONObject): StoredGuestAiSession {
    return StoredGuestAiSession(
        guestToken = jsonObject.getString("guestToken"),
        userId = jsonObject.getString("userId"),
        workspaceId = jsonObject.getString("workspaceId"),
        configurationMode = CloudServiceConfigurationMode.valueOf(jsonObject.getString("configurationMode")),
        apiBaseUrl = jsonObject.getString("apiBaseUrl")
    )
}

private fun encodeWorkspaceLinkSelection(selection: CloudWorkspaceLinkSelection): JSONObject {
    return when (selection) {
        is CloudWorkspaceLinkSelection.Existing -> JSONObject()
            .put("type", "existing")
            .put("workspaceId", selection.workspaceId)
            .put("discardDemoOnly", selection.discardDemoOnly)

        is CloudWorkspaceLinkSelection.CreateNew -> JSONObject()
            .put("type", "create_new")
            .apply {
                if (selection.name != null) {
                    put("name", selection.name)
                }
            }
    }
}

private fun decodeWorkspaceLinkSelection(jsonObject: JSONObject): CloudWorkspaceLinkSelection {
    return when (val selectionType = jsonObject.getString("type")) {
        "existing" -> CloudWorkspaceLinkSelection.Existing(
            workspaceId = jsonObject.getString("workspaceId"),
            discardDemoOnly = if (jsonObject.has("discardDemoOnly")) {
                jsonObject.requireCloudBoolean("discardDemoOnly", "pendingGuestUpgrade.selection.discardDemoOnly")
            } else {
                false
            }
        )
        "create_new" -> CloudWorkspaceLinkSelection.CreateNew(
            name = if (jsonObject.has("name")) {
                jsonObject.requireCloudString("name", "pendingGuestUpgrade.selection.name")
            } else {
                null
            }
        )
        else -> throw IllegalStateException("Unknown pending guest upgrade selection type '$selectionType'.")
    }
}

private fun encodeGuestUpgradeCompletion(completion: CloudGuestUpgradeCompletion): JSONObject {
    val jsonObject = JSONObject()
        .put("workspace", encodeWorkspace(workspace = completion.workspace))
    if (completion.reconciliation == null) {
        jsonObject.put("reconciliation", JSONObject.NULL)
    } else {
        jsonObject.put(
            "reconciliation",
            encodeGuestUpgradeReconciliation(reconciliation = completion.reconciliation)
        )
    }
    return jsonObject
}

private fun decodeGuestUpgradeCompletion(jsonObject: JSONObject): CloudGuestUpgradeCompletion {
    val reconciliation = if (jsonObject.isNull("reconciliation")) {
        null
    } else {
        decodeGuestUpgradeReconciliation(jsonObject = jsonObject.getJSONObject("reconciliation"))
    }
    return CloudGuestUpgradeCompletion(
        workspace = decodeWorkspace(jsonObject = jsonObject.getJSONObject("workspace")),
        reconciliation = reconciliation
    )
}

private fun decodeNullableGuestUpgradeCompletion(jsonObject: JSONObject): CloudGuestUpgradeCompletion? {
    return if (jsonObject.isNull("completion")) {
        null
    } else {
        decodeGuestUpgradeCompletion(jsonObject = jsonObject.getJSONObject("completion"))
    }
}

private fun encodeGuestUpgradeReconciliation(reconciliation: CloudGuestUpgradeReconciliation): JSONObject {
    val droppedEntities = JSONArray()
    reconciliation.droppedEntities.forEach { droppedEntity ->
        droppedEntities.put(
            JSONObject()
                .put("entityType", droppedEntity.entityType.name)
                .put("entityId", droppedEntity.entityId)
        )
    }
    return JSONObject().put("droppedEntities", droppedEntities)
}

private fun decodeGuestUpgradeReconciliation(jsonObject: JSONObject): CloudGuestUpgradeReconciliation {
    val droppedEntities = jsonObject.getJSONArray("droppedEntities")
    return CloudGuestUpgradeReconciliation(
        droppedEntities = buildList {
            for (index in 0 until droppedEntities.length()) {
                val droppedEntity = droppedEntities.getJSONObject(index)
                add(
                    CloudGuestUpgradeDroppedEntity(
                        entityType = CloudGuestUpgradeDroppedEntityType.valueOf(
                            droppedEntity.getString("entityType")
                        ),
                        entityId = droppedEntity.getString("entityId")
                    )
                )
            }
        }
    )
}
