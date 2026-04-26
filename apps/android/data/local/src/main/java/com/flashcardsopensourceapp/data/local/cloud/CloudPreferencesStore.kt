package com.flashcardsopensourceapp.data.local.cloud

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.AppLocalSettingsEntity
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeCompletion
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeDroppedEntity
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeDroppedEntityType
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeReconciliation
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.StoredCloudCredentials
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.UUID
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.coroutineContext

private const val cloudMetadataPreferencesName: String = "flashcards-cloud-metadata"
private const val cloudSecretPreferencesName: String = "flashcards-cloud-secrets"
private const val installationIdKey: String = "installation-id"
private const val cloudStateKey: String = "cloud-state"
private const val linkedUserIdKey: String = "linked-user-id"
private const val linkedWorkspaceIdKey: String = "linked-workspace-id"
private const val linkedEmailKey: String = "linked-email"
private const val activeWorkspaceIdKey: String = "active-workspace-id"
private const val updatedAtMillisKey: String = "updated-at-millis"
private const val accountDeletionStatusKey: String = "account-deletion-status"
private const val accountDeletionFailureMessageKey: String = "account-deletion-failure-message"
private const val customOriginKey: String = "custom-origin"
private const val refreshTokenKey: String = "refresh-token"
private const val idTokenKey: String = "id-token"
private const val idTokenExpiresAtMillisKey: String = "id-token-expires-at-millis"
private const val pendingGuestUpgradeKey: String = "pending-guest-upgrade"
private const val pendingGuestUpgradeLocalOutboxBlockReason: String =
    "Guest upgrade recovery is pending. Wait for account linking recovery to finish before changing cards."

private object LocalOutboxMutationContextKey : CoroutineContext.Key<LocalOutboxMutationContextElement>

private class LocalOutboxMutationContextElement :
    AbstractCoroutineContextElement(LocalOutboxMutationContextKey)

private fun completedUnitSignal(): CompletableDeferred<Unit> {
    val signal: CompletableDeferred<Unit> = CompletableDeferred()
    signal.complete(Unit)
    return signal
}

class CloudPreferencesStore(
    context: Context,
    private val database: AppDatabase
) {
    private val metadataPreferences: SharedPreferences =
        context.getSharedPreferences(cloudMetadataPreferencesName, Context.MODE_PRIVATE)
    private val securePreferences: SharedPreferences = context.getSharedPreferences(
        cloudSecretPreferencesName,
        Context.MODE_PRIVATE
    )

    private val cloudSettingsState = MutableStateFlow(loadLegacyCloudSettingsEntity().toCloudSettings())
    private val accountDeletionState = MutableStateFlow(loadAccountDeletionState())
    private val serverConfigurationState = MutableStateFlow(loadServerConfiguration())
    private val localOutboxWriteGate = Mutex()
    private var localOutboxWriteBlockReason: String? = null
    private var activeLocalOutboxMutationTransactions: Int = 0
    private var localOutboxMutationTransactionsDrained: CompletableDeferred<Unit> = completedUnitSignal()

    fun observeCloudSettings(): StateFlow<CloudSettings> {
        return cloudSettingsState.asStateFlow()
    }

    fun observeServerConfiguration(): StateFlow<CloudServiceConfiguration> {
        return serverConfigurationState.asStateFlow()
    }

    fun observeAccountDeletionState(): StateFlow<AccountDeletionState> {
        return accountDeletionState.asStateFlow()
    }

    fun currentCloudSettings(): CloudSettings {
        return cloudSettingsState.value
    }

    fun currentServerConfiguration(): CloudServiceConfiguration {
        return serverConfigurationState.value
    }

    fun currentAccountDeletionState(): AccountDeletionState {
        return accountDeletionState.value
    }

    fun loadCredentials(): StoredCloudCredentials? {
        val refreshToken = securePreferences.getString(refreshTokenKey, null) ?: return null
        val idToken = securePreferences.getString(idTokenKey, null) ?: return null
        val idTokenExpiresAtMillis = securePreferences.getLong(idTokenExpiresAtMillisKey, 0L)
        if (idTokenExpiresAtMillis <= 0L) {
            return null
        }

        return StoredCloudCredentials(
            refreshToken = refreshToken,
            idToken = idToken,
            idTokenExpiresAtMillis = idTokenExpiresAtMillis
        )
    }

    fun saveCredentials(credentials: StoredCloudCredentials) {
        securePreferences.edit(commit = true) {
            putString(refreshTokenKey, credentials.refreshToken)
            putString(idTokenKey, credentials.idToken)
            putLong(idTokenExpiresAtMillisKey, credentials.idTokenExpiresAtMillis)
        }
    }

    fun clearCredentials() {
        securePreferences.edit(commit = true) {
            remove(refreshTokenKey)
            remove(idTokenKey)
            remove(idTokenExpiresAtMillisKey)
            remove(pendingGuestUpgradeKey)
        }
    }

    fun updateIdToken(idToken: String, idTokenExpiresAtMillis: Long) {
        securePreferences.edit(commit = true) {
            putString(idTokenKey, idToken)
            putLong(idTokenExpiresAtMillisKey, idTokenExpiresAtMillis)
        }
    }

    internal fun loadPendingGuestUpgrade(): PendingGuestUpgradeState? {
        val rawValue = securePreferences.getString(pendingGuestUpgradeKey, null) ?: return null
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

    internal fun savePendingGuestUpgrade(pendingGuestUpgradeState: PendingGuestUpgradeState) {
        securePreferences.edit(commit = true) {
            putString(
                pendingGuestUpgradeKey,
                encodePendingGuestUpgrade(pendingGuestUpgradeState = pendingGuestUpgradeState).toString()
            )
        }
    }

    internal fun clearPendingGuestUpgrade() {
        securePreferences.edit(commit = true) {
            remove(pendingGuestUpgradeKey)
        }
    }

    internal suspend fun <Result> runWithLocalOutboxWritesBlocked(
        reason: String,
        block: suspend () -> Result
    ): Result {
        val transactionsDrained = activateLocalOutboxWriteBlock(reason = reason)
        try {
            transactionsDrained.await()
            return block()
        } finally {
            clearLocalOutboxWriteBlock()
        }
    }

    internal suspend fun <Result> runWithLocalOutboxMutationAllowed(block: suspend () -> Result): Result {
        beginLocalOutboxMutationTransaction()
        try {
            return withContext(LocalOutboxMutationContextElement()) {
                block()
            }
        } finally {
            finishLocalOutboxMutationTransaction()
        }
    }

    internal suspend fun <Result> runWithLocalOutboxWritesAllowed(block: suspend () -> Result): Result {
        if (isLocalOutboxMutationTransactionActive()) {
            return block()
        }

        localOutboxWriteGate.lock()
        try {
            requireLocalOutboxWritesAllowedLocked()
            return block()
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun activateLocalOutboxWriteBlock(reason: String): CompletableDeferred<Unit> {
        localOutboxWriteGate.lock()
        try {
            check(localOutboxWriteBlockReason == null) {
                "Local outbox writes are already blocked. Existing reason='$localOutboxWriteBlockReason'"
            }
            check(hasPendingGuestUpgrade().not()) {
                pendingGuestUpgradeLocalOutboxBlockReason
            }
            localOutboxWriteBlockReason = reason
            return localOutboxMutationTransactionsDrained
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun clearLocalOutboxWriteBlock() {
        localOutboxWriteGate.lock()
        try {
            localOutboxWriteBlockReason = null
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun beginLocalOutboxMutationTransaction() {
        localOutboxWriteGate.lock()
        try {
            requireLocalOutboxWritesAllowedLocked()
            if (activeLocalOutboxMutationTransactions == 0) {
                localOutboxMutationTransactionsDrained = CompletableDeferred()
            }
            activeLocalOutboxMutationTransactions += 1
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun finishLocalOutboxMutationTransaction() {
        localOutboxWriteGate.lock()
        try {
            check(activeLocalOutboxMutationTransactions > 0) {
                "Local outbox mutation transaction finished without a matching start."
            }
            activeLocalOutboxMutationTransactions -= 1
            if (activeLocalOutboxMutationTransactions == 0) {
                localOutboxMutationTransactionsDrained.complete(Unit)
            }
        } finally {
            localOutboxWriteGate.unlock()
        }
    }

    private suspend fun isLocalOutboxMutationTransactionActive(): Boolean {
        return coroutineContext[LocalOutboxMutationContextKey] != null
    }

    private fun requireLocalOutboxWritesAllowedLocked() {
        if (hasPendingGuestUpgrade()) {
            throw IllegalStateException(pendingGuestUpgradeLocalOutboxBlockReason)
        }
        val blockedReason = localOutboxWriteBlockReason ?: return
        throw IllegalStateException(blockedReason)
    }

    private fun hasPendingGuestUpgrade(): Boolean {
        return securePreferences.contains(pendingGuestUpgradeKey)
    }

    suspend fun hydrateCloudSettingsFromDatabase(): CloudSettings {
        val hydratedSettings = loadPersistedCloudSettingsEntity()
        return persistInMemoryCloudSettings(settings = hydratedSettings)
    }

    suspend fun updateCloudSettings(
        cloudState: CloudAccountState,
        linkedUserId: String?,
        linkedWorkspaceId: String?,
        linkedEmail: String?,
        activeWorkspaceId: String?
    ) {
        val updatedAtMillis = System.currentTimeMillis()
        val currentSettings = currentCloudSettingsEntity()
        val updatedSettings = currentSettings.copy(
            cloudState = cloudState.name,
            linkedUserId = linkedUserId,
            linkedWorkspaceId = linkedWorkspaceId,
            linkedEmail = linkedEmail,
            activeWorkspaceId = activeWorkspaceId,
            updatedAtMillis = updatedAtMillis
        )
        database.appLocalSettingsDao().insertSettings(updatedSettings)
        persistInMemoryCloudSettings(settings = updatedSettings)
    }

    suspend fun updateActiveWorkspaceId(activeWorkspaceId: String?) {
        val updatedAtMillis = System.currentTimeMillis()
        val currentSettings = currentCloudSettingsEntity()
        val updatedSettings = currentSettings.copy(
            activeWorkspaceId = activeWorkspaceId,
            updatedAtMillis = updatedAtMillis
        )
        database.appLocalSettingsDao().insertSettings(updatedSettings)
        persistInMemoryCloudSettings(settings = updatedSettings)
    }

    fun markAccountDeletionInProgress() {
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusInProgress)
            remove(accountDeletionFailureMessageKey)
        }
        accountDeletionState.value = AccountDeletionState.InProgress
    }

    fun markAccountDeletionFailed(message: String) {
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusFailed)
            putString(accountDeletionFailureMessageKey, message)
        }
        accountDeletionState.value = AccountDeletionState.Failed(message = message)
    }

    fun clearAccountDeletionState() {
        metadataPreferences.edit(commit = true) {
            putString(accountDeletionStatusKey, accountDeletionStatusHidden)
            remove(accountDeletionFailureMessageKey)
        }
        accountDeletionState.value = AccountDeletionState.Hidden
    }

    suspend fun regenerateInstallationId(): String {
        // Installation identity is global per app install and must never be reused
        // after an explicit local identity reset.
        val installationId = UUID.randomUUID().toString()
        val updatedAtMillis = System.currentTimeMillis()
        val currentSettings = currentCloudSettingsEntity()
        val updatedSettings = currentSettings.copy(
            installationId = installationId,
            updatedAtMillis = updatedAtMillis
        )
        database.appLocalSettingsDao().insertSettings(updatedSettings)
        persistInMemoryCloudSettings(settings = updatedSettings)
        return installationId
    }

    fun applyCustomServer(configuration: CloudServiceConfiguration) {
        val customOrigin = requireNotNull(configuration.customOrigin) {
            "Custom server configuration must include the original origin."
        }
        metadataPreferences.edit(commit = true) {
            putString(customOriginKey, customOrigin)
        }
        serverConfigurationState.value = loadServerConfiguration()
    }

    fun resetToOfficialServer() {
        metadataPreferences.edit(commit = true) {
            remove(customOriginKey)
        }
        serverConfigurationState.value = loadServerConfiguration()
    }

    private fun loadServerConfiguration(): CloudServiceConfiguration {
        val customOrigin = metadataPreferences.getString(customOriginKey, null)
        return if (customOrigin == null) {
            makeOfficialCloudServiceConfiguration()
        } else {
            makeCustomCloudServiceConfiguration(customOrigin = customOrigin)
        }
    }

    private fun loadAccountDeletionState(): AccountDeletionState {
        return when (metadataPreferences.getString(accountDeletionStatusKey, accountDeletionStatusHidden)) {
            accountDeletionStatusInProgress -> AccountDeletionState.InProgress
            accountDeletionStatusFailed -> AccountDeletionState.Failed(
                message = metadataPreferences.getString(accountDeletionFailureMessageKey, null)
                    ?: "Account deletion failed."
            )
            else -> AccountDeletionState.Hidden
        }
    }

    private fun createInstallationId(): String {
        // The first generated installation id survives user and workspace switches.
        val installationId = UUID.randomUUID().toString()
        metadataPreferences.edit(commit = true) {
            putString(installationIdKey, installationId)
        }
        return installationId
    }

    private fun currentCloudSettingsEntity(): AppLocalSettingsEntity {
        val currentSettings = cloudSettingsState.value
        return AppLocalSettingsEntity(
            settingsId = 1,
            installationId = currentSettings.installationId,
            cloudState = currentSettings.cloudState.name,
            linkedUserId = currentSettings.linkedUserId,
            linkedWorkspaceId = currentSettings.linkedWorkspaceId,
            linkedEmail = currentSettings.linkedEmail,
            activeWorkspaceId = currentSettings.activeWorkspaceId,
            updatedAtMillis = currentSettings.updatedAtMillis
        )
    }

    private suspend fun loadPersistedCloudSettingsEntity(): AppLocalSettingsEntity {
        val storedSettings = database.appLocalSettingsDao().loadSettings()
        if (storedSettings != null) {
            return storedSettings
        }

        val migratedSettings = migrateLegacyCloudSettings()
        database.appLocalSettingsDao().insertSettings(migratedSettings)
        return migratedSettings
    }

    private suspend fun migrateLegacyCloudSettings(): AppLocalSettingsEntity {
        val installationId = metadataPreferences.getString(installationIdKey, null) ?: createInstallationId()
        val activeWorkspaceId = metadataPreferences.getString(activeWorkspaceIdKey, null)
            ?: database.workspaceDao().loadAnyWorkspace()?.workspaceId
        return AppLocalSettingsEntity(
            settingsId = 1,
            installationId = installationId,
            cloudState = metadataPreferences.getString(cloudStateKey, CloudAccountState.DISCONNECTED.name)
                ?: CloudAccountState.DISCONNECTED.name,
            linkedUserId = metadataPreferences.getString(linkedUserIdKey, null),
            linkedWorkspaceId = metadataPreferences.getString(linkedWorkspaceIdKey, null),
            linkedEmail = metadataPreferences.getString(linkedEmailKey, null),
            activeWorkspaceId = activeWorkspaceId,
            updatedAtMillis = metadataPreferences.getLong(updatedAtMillisKey, 0L)
        )
    }

    private fun loadLegacyCloudSettingsEntity(): AppLocalSettingsEntity {
        val installationId = metadataPreferences.getString(installationIdKey, null) ?: createInstallationId()
        return AppLocalSettingsEntity(
            settingsId = 1,
            installationId = installationId,
            cloudState = metadataPreferences.getString(cloudStateKey, CloudAccountState.DISCONNECTED.name)
                ?: CloudAccountState.DISCONNECTED.name,
            linkedUserId = metadataPreferences.getString(linkedUserIdKey, null),
            linkedWorkspaceId = metadataPreferences.getString(linkedWorkspaceIdKey, null),
            linkedEmail = metadataPreferences.getString(linkedEmailKey, null),
            activeWorkspaceId = metadataPreferences.getString(activeWorkspaceIdKey, null),
            updatedAtMillis = metadataPreferences.getLong(updatedAtMillisKey, 0L)
        )
    }

    private fun persistInMemoryCloudSettings(settings: AppLocalSettingsEntity): CloudSettings {
        mirrorLegacyCloudSettings(settings)
        val cloudSettings = settings.toCloudSettings()
        cloudSettingsState.value = cloudSettings
        return cloudSettings
    }

    private fun mirrorLegacyCloudSettings(settings: AppLocalSettingsEntity) {
        metadataPreferences.edit(commit = true) {
            putString(installationIdKey, settings.installationId)
            putString(cloudStateKey, settings.cloudState)
            putString(linkedUserIdKey, settings.linkedUserId)
            putString(linkedWorkspaceIdKey, settings.linkedWorkspaceId)
            putString(linkedEmailKey, settings.linkedEmail)
            putString(activeWorkspaceIdKey, settings.activeWorkspaceId)
            putLong(updatedAtMillisKey, settings.updatedAtMillis)
        }
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
)

private fun AppLocalSettingsEntity.toCloudSettings(): CloudSettings {
    return CloudSettings(
        installationId = installationId,
        cloudState = CloudAccountState.valueOf(cloudState),
        linkedUserId = linkedUserId,
        linkedWorkspaceId = linkedWorkspaceId,
        linkedEmail = linkedEmail,
        activeWorkspaceId = activeWorkspaceId,
        updatedAtMillis = updatedAtMillis
    )
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
        .put("workspaces", encodeWorkspaces(workspaces = accountSnapshot.workspaces))
}

private fun decodeAccountSnapshot(jsonObject: JSONObject): CloudAccountSnapshot {
    return CloudAccountSnapshot(
        userId = jsonObject.getString("userId"),
        email = jsonObject.getNullableString(key = "email"),
        workspaces = decodeWorkspaces(jsonArray = jsonObject.getJSONArray("workspaces"))
    )
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
}

private fun decodeWorkspace(jsonObject: JSONObject): CloudWorkspaceSummary {
    return CloudWorkspaceSummary(
        workspaceId = jsonObject.getString("workspaceId"),
        name = jsonObject.getString("name"),
        createdAtMillis = jsonObject.getLong("createdAtMillis"),
        isSelected = jsonObject.getBoolean("isSelected")
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

        CloudWorkspaceLinkSelection.CreateNew -> JSONObject()
            .put("type", "create_new")
    }
}

private fun decodeWorkspaceLinkSelection(jsonObject: JSONObject): CloudWorkspaceLinkSelection {
    return when (val selectionType = jsonObject.getString("type")) {
        "existing" -> CloudWorkspaceLinkSelection.Existing(
            workspaceId = jsonObject.getString("workspaceId")
        )
        "create_new" -> CloudWorkspaceLinkSelection.CreateNew
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

private fun JSONObject.getNullableString(key: String): String? {
    return if (isNull(key)) {
        null
    } else {
        getString(key)
    }
}

private const val accountDeletionStatusHidden: String = "hidden"
private const val accountDeletionStatusInProgress: String = "in_progress"
private const val accountDeletionStatusFailed: String = "failed"
